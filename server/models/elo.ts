import { INITIAL_ELO, INACTIVITY_HALF_LIFE_DAYS, K_FACTOR, SAMPLE_PRIOR } from './constants'

export { INITIAL_ELO, K_FACTOR }

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
  const sampleWeight = mode === 'full' ? matchCount / (matchCount + SAMPLE_PRIOR) : 1
  const idleDays = lastPlayedOn ? daysBetween(lastPlayedOn, asOf) : 0
  const inactivityWeight = 0.5 ** (idleDays / INACTIVITY_HALF_LIFE_DAYS)
  return INITIAL_ELO + (rating - INITIAL_ELO) * sampleWeight * inactivityWeight
}

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean) => {
  const expectedA = expectedScore(ratingA, ratingB)
  const scoreA = sideAWon ? 1 : 0
  const expectedB = 1 - expectedA
  const scoreB = 1 - scoreA

  return {
    expectedA,
    ratingA: ratingA + K_FACTOR * (scoreA - expectedA),
    ratingB: ratingB + K_FACTOR * (scoreB - expectedB),
  }
}
