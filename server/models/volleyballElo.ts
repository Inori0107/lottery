import {
  VOLLEYBALL_HOME_ADVANTAGE_CLUB,
  VOLLEYBALL_HOME_ADVANTAGE_NATIONAL,
  VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS,
  VOLLEYBALL_INITIAL_ELO,
  VOLLEYBALL_K_FACTOR,
  VOLLEYBALL_ROSTER_STRENGTH_FACTOR,
  VOLLEYBALL_SAMPLE_PRIOR,
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
  VOLLEYBALL_INITIAL_ELO,
  VOLLEYBALL_K_FACTOR,
  daysBetween,
  expectedScore,
}
export type { ShrinkMode }

export const VOLLEYBALL_ELO: EloParams = {
  initialElo: VOLLEYBALL_INITIAL_ELO,
  kFactor: VOLLEYBALL_K_FACTOR,
  samplePrior: VOLLEYBALL_SAMPLE_PRIOR,
  inactivityHalfLifeDays: VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS,
}

export type HomeAdvantageMode = 'club' | 'national' | 'neutral'

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
) => coreEffectiveRating(rating, matchCount, lastPlayedOn, asOf, mode, VOLLEYBALL_ELO)

export const getHomeAdvantage = (mode: HomeAdvantageMode): number => {
  if (mode === 'club') return VOLLEYBALL_HOME_ADVANTAGE_CLUB
  if (mode === 'national') return VOLLEYBALL_HOME_ADVANTAGE_NATIONAL
  return 0
}

export const detectHomeAdvantageMode = (tournament: string): HomeAdvantageMode => {
  const lower = tournament.toLowerCase()
  if (
    lower.includes('olympic')
    || lower.includes('world championship')
    || lower.includes('vnl')
    || lower.includes('nations league')
    || lower.includes('world cup')
  ) {
    return 'neutral'
  }
  if (
    lower.includes('league')
    || lower.includes('liga')
    || lower.includes('serie')
    || lower.includes('superliga')
    || lower.includes('superlega')
    || lower.includes('plusliga')
    || lower.includes('tvl')
    || lower.includes('tpvl')
    || lower.includes('championship')
    || lower.includes('cup')
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
  rosterStrength: number,
) => {
  const homeBonus = isHome ? getHomeAdvantage(homeAdvantageMode) : 0
  return baseRating + homeBonus + (rosterStrength - 1) * VOLLEYBALL_ROSTER_STRENGTH_FACTOR
}

export const expectedScoreWithFactors = (
  ratingA: number,
  ratingB: number,
  sideAIsHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
  rosterStrengthA: number,
  rosterStrengthB: number,
) => expectedScore(
  adjustedRating(ratingA, sideAIsHome, homeAdvantageMode, rosterStrengthA),
  adjustedRating(ratingB, !sideAIsHome, homeAdvantageMode, rosterStrengthB),
)

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean) =>
  coreUpdateElo(ratingA, ratingB, sideAWon, VOLLEYBALL_K_FACTOR)

export const updateEloWithFactors = (
  ratingA: number,
  ratingB: number,
  sideAWon: boolean,
  sideAIsHome: boolean,
  homeAdvantageMode: HomeAdvantageMode,
  rosterStrengthA: number,
  rosterStrengthB: number,
) => applyEloResult(
  ratingA,
  ratingB,
  sideAWon,
  expectedScoreWithFactors(
    ratingA,
    ratingB,
    sideAIsHome,
    homeAdvantageMode,
    rosterStrengthA,
    rosterStrengthB,
  ),
  VOLLEYBALL_K_FACTOR,
)


