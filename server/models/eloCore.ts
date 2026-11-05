export type ShrinkMode = 'raw' | 'inactivity' | 'full'

export type EloParams = {
  initialElo: number
  kFactor: number
  samplePrior: number
  inactivityHalfLifeDays: number
}

export const expectedScore = (ratingA: number, ratingB: number) =>
  1 / (1 + 10 ** ((ratingB - ratingA) / 400))

export const daysBetween = (from: string | null | undefined, to: string) => {
  if (!from) return 0
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export const effectiveRating = (
  rating: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode = 'full',
  params: EloParams,
) => {
  if (mode === 'raw') return rating
  const sampleWeight = mode === 'full' ? matchCount / (matchCount + params.samplePrior) : 1
  const idleDays = lastPlayedOn ? daysBetween(lastPlayedOn, asOf) : 0
  const inactivityWeight = 0.5 ** (idleDays / params.inactivityHalfLifeDays)
  return params.initialElo + (rating - params.initialElo) * sampleWeight * inactivityWeight
}

export const applyEloResult = (
  ratingA: number,
  ratingB: number,
  sideAWon: boolean,
  expectedA: number,
  kFactor: number,
) => {
  const scoreA = sideAWon ? 1 : 0
  return {
    expectedA,
    ratingA: ratingA + kFactor * (scoreA - expectedA),
    ratingB: ratingB + kFactor * ((1 - scoreA) - (1 - expectedA)),
  }
}

export const updateElo = (ratingA: number, ratingB: number, sideAWon: boolean, kFactor: number) =>
  applyEloResult(ratingA, ratingB, sideAWon, expectedScore(ratingA, ratingB), kFactor)
