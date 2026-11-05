import {
  FOOTBALL_HOME_ADVANTAGE,
  FOOTBALL_INACTIVITY_HALF_LIFE_DAYS,
  FOOTBALL_INITIAL_ELO,
  FOOTBALL_K_FACTOR,
  FOOTBALL_SAMPLE_PRIOR,
} from './constants'
import {
  applyEloResult,
  daysBetween,
  effectiveRating as coreEffectiveRating,
  expectedScore,
  updateElo as coreUpdateElo,
  type EloParams,
  type ShrinkMode,
} from './eloCore'

export {
  FOOTBALL_INITIAL_ELO,
  FOOTBALL_K_FACTOR,
  daysBetween,
  expectedScore,
}
export type { ShrinkMode }

export const FOOTBALL_ELO: EloParams = {
  initialElo: FOOTBALL_INITIAL_ELO,
  kFactor: FOOTBALL_K_FACTOR,
  samplePrior: FOOTBALL_SAMPLE_PRIOR,
  inactivityHalfLifeDays: FOOTBALL_INACTIVITY_HALF_LIFE_DAYS,
}

export type HomeAdvantageMode = 'club' | 'national' | 'neutral'

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
) => coreEffectiveRating(rating, matchCount, lastPlayedOn, asOf, mode, FOOTBALL_ELO)

export const getHomeAdvantage = (mode: HomeAdvantageMode): number => {
  if (mode === 'club') return FOOTBALL_HOME_ADVANTAGE
  if (mode === 'national') return Math.round(FOOTBALL_HOME_ADVANTAGE * 0.6)
  return 0
}

export const detectHomeAdvantageMode = (tournament: string): HomeAdvantageMode => {
  const lower = tournament.toLowerCase()
  if (
    lower.includes('world cup')
    || lower.includes('euro ')
    || lower.includes('copa america')
    || lower.includes('nations league')
    || lower.includes('international')
    || lower.includes('friendl')
    || lower.includes('友誼賽')
    || lower.includes('世界盃')
    || lower.includes('歐洲國家盃')
  ) {
    return 'neutral'
  }
  if (
    lower.includes('league')
    || lower.includes('liga')
    || lower.includes('serie')
    || lower.includes('ligue')
    || lower.includes('bundesliga')
    || lower.includes('premier')
    || lower.includes('championship')
    || lower.includes('cup')
    || lower.includes('中超')
    || lower.includes('英超')
    || lower.includes('西甲')
    || lower.includes('德甲')
    || lower.includes('意甲')
    || lower.includes('法甲')
  ) {
    return 'club'
  }
  return 'neutral'
}

export const venueModeForQuote = (isHome: boolean, tournament = ''): HomeAdvantageMode => {
  if (!isHome) return 'neutral'
  const detected = detectHomeAdvantageMode(tournament)
  if (detected !== 'neutral') return detected
  return tournament.trim() ? 'neutral' : 'club'
}

export const adjustedRating = (
  baseRating: number,
  isHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
) => {
  const homeBonus = isHome ? getHomeAdvantage(homeAdvantageMode) : 0
  return baseRating + homeBonus
}

export const expectedScoreWithFactors = (
  ratingA: number,
  ratingB: number,
  sideAIsHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
) => expectedScore(
  adjustedRating(ratingA, sideAIsHome, homeAdvantageMode),
  adjustedRating(ratingB, !sideAIsHome, homeAdvantageMode),
)

export const updateElo = (ratingA: number, ratingB: number, scoreA: number, scoreB: number) => {
  const expected = expectedScore(ratingA, ratingB)
  let actual: number
  if (scoreA > scoreB) actual = 1
  else if (scoreA < scoreB) actual = 0
  else actual = 0.5
  const delta = FOOTBALL_K_FACTOR * (actual - expected)
  return {
    expectedA: expected,
    actualA: actual,
    ratingA: Math.round(ratingA + delta),
    ratingB: Math.round(ratingB - delta),
  }
}

export const updateEloWithFactors = (
  ratingA: number,
  ratingB: number,
  scoreA: number,
  scoreB: number,
  sideAIsHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
) => {
  const expected = expectedScoreWithFactors(
    ratingA,
    ratingB,
    sideAIsHome,
    homeAdvantageMode,
  )
  let actual: number
  if (scoreA > scoreB) actual = 1
  else if (scoreA < scoreB) actual = 0
  else actual = 0.5
  const delta = FOOTBALL_K_FACTOR * (actual - expected)
  return {
    expectedA: expected,
    actualA: actual,
    ratingA: Math.round(ratingA + delta),
    ratingB: Math.round(ratingB - delta),
  }
}
