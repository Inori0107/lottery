/**
 * 網球 Elo 評分系統
 *
 * 特點：
 * - 基礎 K 值 = 32（與羽球相同）
 * - 場地類型調整（紅土選手在紅土場有優勢）
 * - 停賽衰減（長期未出賽向 1500 回歸）
 */

import {
  TENNIS_INITIAL_ELO,
  TENNIS_K_FACTOR,
  TENNIS_INACTIVITY_HALF_LIFE_DAYS,
  TENNIS_SAMPLE_PRIOR,
  TENNIS_SURFACE_BONUS,
} from './constants'

export const INITIAL_ELO = TENNIS_INITIAL_ELO
export const K_FACTOR = TENNIS_K_FACTOR

export type Surface = 'hard' | 'clay' | 'grass' | 'carpet'

export type SurfacePreference = {
  hard: number
  clay: number
  grass: number
  carpet: number
}

const defaultSurfacePreference: SurfacePreference = {
  hard: 1.0,
  clay: 1.0,
  grass: 1.0,
  carpet: 1.0,
}

export const expectedScore = (ratingA: number, ratingB: number): number => {
  const diff = ratingA - ratingB
  return 1 / (1 + Math.pow(10, -diff / 400))
}

export const expectedScoreWithSurface = (
  ratingA: number,
  ratingB: number,
  surface: Surface | undefined,
  prefA: SurfacePreference = defaultSurfacePreference,
  prefB: SurfacePreference = defaultSurfacePreference,
): number => {
  if (!surface) return expectedScore(ratingA, ratingB)

  const surfaceBonus = (prefA[surface] - prefB[surface]) * TENNIS_SURFACE_BONUS
  return expectedScore(ratingA + surfaceBonus, ratingB)
}

export const updateElo = (
  ratingA: number,
  ratingB: number,
  aWon: boolean,
  k: number = K_FACTOR,
) => {
  const expected = expectedScore(ratingA, ratingB)
  const actual = aWon ? 1 : 0
  const delta = k * (actual - expected)
  return {
    ratingA: ratingA + delta,
    ratingB: ratingB - delta,
    expectedA: expected,
  }
}

export const daysBetween = (from: string | null, to: string) => {
  if (!from) return 0
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export type ShrinkMode = 'raw' | 'inactivity' | 'full'

export const effectiveRating = (
  elo: number,
  matchCount: number,
  lastPlayedOn: string | null,
  asOf: string,
  mode: ShrinkMode,
): number => {
  if (mode === 'raw') return elo

  let rating = elo

  if (mode === 'inactivity' || mode === 'full') {
    const idleDays = daysBetween(lastPlayedOn, asOf)
    const decayFactor = Math.pow(0.5, idleDays / TENNIS_INACTIVITY_HALF_LIFE_DAYS)
    rating = INITIAL_ELO + (rating - INITIAL_ELO) * decayFactor
  }

  if (mode === 'full') {
    const shrinkFactor = matchCount / (matchCount + TENNIS_SAMPLE_PRIOR)
    rating = INITIAL_ELO + (rating - INITIAL_ELO) * shrinkFactor
  }

  return rating
}

export const surfaceAdjustedRating = (
  rating: number,
  surface: Surface | undefined,
  preference: SurfacePreference = defaultSurfacePreference,
): number => {
  if (!surface) return rating
  return rating + (preference[surface] - 1.0) * TENNIS_SURFACE_BONUS
}
