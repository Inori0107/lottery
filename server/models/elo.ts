import { INITIAL_ELO, INACTIVITY_HALF_LIFE_DAYS, K_FACTOR, SAMPLE_PRIOR } from './constants'
import {
  daysBetween,
  effectiveRating as coreEffectiveRating,
  expectedScore,
  updateElo as coreUpdateElo,
  type EloParams,
  type ShrinkMode,
} from './eloCore'

export { INITIAL_ELO, K_FACTOR, daysBetween, expectedScore }
export type { ShrinkMode }

export const BADMINTON_ELO: EloParams = {
  initialElo: INITIAL_ELO,
  kFactor: K_FACTOR,
  samplePrior: SAMPLE_PRIOR,
  inactivityHalfLifeDays: INACTIVITY_HALF_LIFE_DAYS,
}

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
) => coreEffectiveRating(rating, matchCount, lastPlayedOn, asOf, mode, BADMINTON_ELO)

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean) =>
  coreUpdateElo(ratingA, ratingB, sideAWon, K_FACTOR)
