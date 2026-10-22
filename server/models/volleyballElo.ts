/**
 * 排球 Elo 評分模型
 * 
 * 與羽球 Elo 的差異：
 * 1. 評估對象是隊伍（team）而非個人（player）
 * 2. 加入主場優勢調整
 * 3. 加入陣容強度調整（考慮傷兵、主力球員出場等）
 * 
 * 主場優勢模型：
 * - 職業聯賽：約 +50-70 Elo（觀眾、旅途疲勞）
 * - 國際賽事：約 +20-30 Elo（較中性場地）
 * 
 * 陣容強度模型：
 * - 基準值 1.0 代表完整陣容
 * - < 1.0 代表有傷兵或主力缺席
 * - 每 0.1 差距約影響 20 Elo
 */

export const VOLLEYBALL_INITIAL_ELO = 1500
export const VOLLEYBALL_K_FACTOR = 32
export const VOLLEYBALL_SAMPLE_PRIOR = 30
export const VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS = 120

export const HOME_ADVANTAGE_CLUB = 60
export const HOME_ADVANTAGE_NATIONAL = 25
export const ROSTER_STRENGTH_FACTOR = 200

export type HomeAdvantageMode = 'club' | 'national' | 'neutral'

export const expectedScore = (ratingA: number, ratingB: number) =>
  1 / (1 + 10 ** ((ratingB - ratingA) / 400))

export const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export type ShrinkMode = 'raw' | 'inactivity' | 'full'

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
) => {
  if (mode === 'raw') return rating
  const sampleWeight = mode === 'full' ? matchCount / (matchCount + VOLLEYBALL_SAMPLE_PRIOR) : 1
  const idleDays = lastPlayedOn ? daysBetween(lastPlayedOn, asOf) : 0
  const inactivityWeight = 0.5 ** (idleDays / VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS)
  return VOLLEYBALL_INITIAL_ELO + (rating - VOLLEYBALL_INITIAL_ELO) * sampleWeight * inactivityWeight
}

export const getHomeAdvantage = (mode: HomeAdvantageMode): number => {
  switch (mode) {
    case 'club':
      return HOME_ADVANTAGE_CLUB
    case 'national':
      return HOME_ADVANTAGE_NATIONAL
    case 'neutral':
      return 0
  }
}

export const detectHomeAdvantageMode = (tournament: string): HomeAdvantageMode => {
  const lower = tournament.toLowerCase()

  if (
    lower.includes('olympic') ||
    lower.includes('world championship') ||
    lower.includes('vnl') ||
    lower.includes('nations league') ||
    lower.includes('world cup')
  ) {
    return 'national'
  }

  if (
    lower.includes('league') ||
    lower.includes('liga') ||
    lower.includes('serie') ||
    lower.includes('championship') ||
    lower.includes('cup')
  ) {
    return 'club'
  }

  return 'neutral'
}

export const adjustedRating = (
  baseRating: number,
  isHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
  rosterStrength: number,
) => {
  let adjusted = baseRating

  if (isHome) {
    adjusted += getHomeAdvantage(homeAdvantageMode)
  }

  const rosterAdjustment = (rosterStrength - 1.0) * ROSTER_STRENGTH_FACTOR
  adjusted += rosterAdjustment

  return adjusted
}

export const expectedScoreWithFactors = (
  ratingA: number,
  ratingB: number,
  sideAIsHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
  rosterStrengthA: number,
  rosterStrengthB: number,
) => {
  const adjustedA = adjustedRating(ratingA, sideAIsHome, homeAdvantageMode, rosterStrengthA)
  const adjustedB = adjustedRating(ratingB, !sideAIsHome, homeAdvantageMode, rosterStrengthB)
  return expectedScore(adjustedA, adjustedB)
}

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean) => {
  const expectedA = expectedScore(ratingA, ratingB)
  const scoreA = sideAWon ? 1 : 0
  const expectedB = 1 - expectedA
  const scoreB = 1 - scoreA

  return {
    expectedA,
    ratingA: ratingA + VOLLEYBALL_K_FACTOR * (scoreA - expectedA),
    ratingB: ratingB + VOLLEYBALL_K_FACTOR * (scoreB - expectedB),
  }
}

export type TeamState = {
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1History: number[]
  recentOpponents: string[]
  homeWinRate: number | null
  awayWinRate: number | null
}

export type StoredTeamRating = {
  discipline: 'M' | 'W'
  teamId: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1Recent: number[]
  homeAdvantage: number
  rosterStrength: number
}

export const estimateRosterStrength = (
  recentResults: boolean[],
  averageMargin: number,
): number => {
  if (recentResults.length === 0) return 1.0

  const recentWinRate = recentResults.filter(r => r).length / recentResults.length
  const expectedWinRate = 0.5

  const marginFactor = averageMargin > 0 ? 0.05 : averageMargin < 0 ? -0.05 : 0

  const rosterStrength = 1.0 + (recentWinRate - expectedWinRate) * 0.2 + marginFactor

  return Math.max(0.7, Math.min(1.3, rosterStrength))
}

export const estimateHomeAdvantage = (
  homeWins: number,
  homeMatches: number,
  awayWins: number,
  awayMatches: number,
): number => {
  if (homeMatches < 5 || awayMatches < 5) return HOME_ADVANTAGE_CLUB

  const homeWinRate = homeWins / homeMatches
  const awayWinRate = awayWins / awayMatches

  const diff = homeWinRate - awayWinRate

  const estimatedAdvantage = diff * 400

  return Math.max(20, Math.min(100, HOME_ADVANTAGE_CLUB + estimatedAdvantage))
}
