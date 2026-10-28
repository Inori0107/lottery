import {
  TENNIS_INACTIVITY_HALF_LIFE_DAYS,
  TENNIS_INITIAL_ELO,
  TENNIS_K_FACTOR,
  TENNIS_SAMPLE_PRIOR,
} from './constants'
import {
  daysBetween,
  effectiveRating as coreEffectiveRating,
  expectedScore,
  updateElo as coreUpdateElo,
  type EloParams,
  type ShrinkMode,
} from './eloCore'

export {
  TENNIS_INITIAL_ELO,
  TENNIS_K_FACTOR,
  daysBetween,
  expectedScore,
}
export type { ShrinkMode }

export const TENNIS_ELO: EloParams = {
  initialElo: TENNIS_INITIAL_ELO,
  kFactor: TENNIS_K_FACTOR,
  samplePrior: TENNIS_SAMPLE_PRIOR,
  inactivityHalfLifeDays: TENNIS_INACTIVITY_HALF_LIFE_DAYS,
}

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
) => coreEffectiveRating(rating, matchCount, lastPlayedOn, asOf, mode, TENNIS_ELO)

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean) =>
  coreUpdateElo(ratingA, ratingB, sideAWon, TENNIS_K_FACTOR)
