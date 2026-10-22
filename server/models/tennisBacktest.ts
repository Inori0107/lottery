/**
 * 網球回測模組
 *
 * 功能：
 * 1. 從歷史資料建立 Elo 評分系統
 * 2. 訓練每分得分模型
 * 3. 評估模型效能並校準
 * 4. 儲存模型參數與預測結果
 */

import type { TennisDiscipline, Split } from '../../shared/types'
import { TENNIS_CORRECT_SCORES, type TennisCorrectScore } from '../../shared/types'
import {
  TENNIS_INITIAL_ELO,
  TENNIS_INACTIVITY_HALF_LIFE_DAYS,
  TENNIS_SAMPLE_PRIOR,
} from './constants'
import { expectedScoreWithSurface, effectiveRating, updateElo, type Surface, type SurfacePreference } from './tennisElo'
import {
  tennisMatchDistribution,
  probabilityAbove,
  coversHandicap,
  fairLine,
  fitTennisRallyModel,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  type TennisRallyModel,
  type TennisRallyMatchRow,
} from './tennisRally'
import { calibrationBins, logLoss, type CalibrationBin } from './game1'
import type { TennisSetResult } from './tennisDataset'

export type TennisBacktestMatch = {
  matchId: string
  discipline: TennisDiscipline
  playedOn: string
  sideAId: string
  sideBId: string
  surface?: Surface
  includeMatch: boolean
  includeSet1: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  sets: TennisSetResult[]
}

export type TennisStoredRating = {
  discipline: TennisDiscipline
  playerId: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  surfacePreference: SurfacePreference
  set1Recent: number[]
}

export type TennisPointsMarketTest = {
  n: number
  logLoss: number | null
  baselineLogLoss: number | null
  fairLineRate?: number | null
  calibration: CalibrationBin[]
}

export type TennisModelPayload = {
  trainEnd: string
  validEnd: string
  counts: Record<Split, { match: number, set1: number }>
  shrink: {
    enabled: boolean
    mode: 'raw' | 'inactivity' | 'full'
    samplePrior: number
    halfLifeDays: number
  }
  validation: {
    matchEloRaw: number | null
    matchEloIdle: number | null
    matchEloEff: number | null
  }
  test: {
    match: {
      logLoss: number | null
      brier: number | null
      baselineLogLoss: number | null
      n: number
      calibration: CalibrationBin[]
    }
    set1: {
      logLoss: number | null
      brier: number | null
      n: number
      calibration: CalibrationBin[]
    }
    totals?: TennisPointsMarketTest
    handicap?: TennisPointsMarketTest
    correctScore?: TennisPointsMarketTest
  }
  rally?: TennisRallyModel
  calibration?: {
    match?: CalibrationBin[]
    set1?: CalibrationBin[]
    totals?: CalibrationBin[]
    handicap?: CalibrationBin[]
    correctScore?: CalibrationBin[]
  }
}

export type TennisPredictionRow = {
  matchId: string
  marketType: 'match_winner' | 'set1_winner'
  modelVersion: string
  pSideA: number
  featureAsOf: string
  split: Split
}

export type TennisDisciplineResult = {
  discipline: TennisDiscipline
  modelVersion: string
  set1Method: 'bo3'
  payload: TennisModelPayload
  dataThrough: string
  predictions: TennisPredictionRow[]
  ratings: TennisStoredRating[]
}

type PlayerState = {
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1History: number[]
  surfacePreference: SurfacePreference
}

type Snapshot = {
  matchId: string
  playedOn: string
  split: Split
  y: number
  pMatchRaw: number
  pMatchIdle: number
  eloDiffRaw: number
  eloDiffIdle: number
}

type PointsSnapshot = Omit<Snapshot, 'y'> & {
  sets: TennisSetResult[]
  matchComplete: boolean
}

const mean = (values: number[]) => values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null

const averageLogLoss = <T>(rows: T[], probability: (row: T) => number, outcome: (row: T) => number) => {
  const losses = rows.map(row => logLoss(probability(row), outcome(row)))
  return mean(losses)
}

const averageBrier = <T>(rows: T[], probability: (row: T) => number, outcome: (row: T) => number) => {
  const scores = rows.map((row) => {
    const p = probability(row)
    const y = outcome(row)
    return (p - y) ** 2
  })
  return mean(scores)
}

const correctScoreOf = (sets: TennisSetResult[]): TennisCorrectScore => {
  const winsA = sets.filter(set => set.sideAWon).length
  const winsB = sets.length - winsA
  return `${winsA}:${winsB}` as TennisCorrectScore
}

const splitFor = (playedOn: string, trainEnd: string, validEnd: string): Split => {
  if (playedOn <= trainEnd) return 'train'
  if (playedOn <= validEnd) return 'valid'
  return 'test'
}

const emptyCounts = (): Record<Split, { match: number, set1: number }> => ({
  train: { match: 0, set1: 0 },
  valid: { match: 0, set1: 0 },
  test: { match: 0, set1: 0 },
})

const defaultSurfacePreference = (): SurfacePreference => ({
  hard: 1.0,
  clay: 1.0,
  grass: 1.0,
  carpet: 1.0,
})

export const buildTennisModelVersion = (mode: 'raw' | 'inactivity' | 'full') => {
  if (mode === 'full') return `tennis-elo-k32-1500-n${TENNIS_SAMPLE_PRIOR}-h${TENNIS_INACTIVITY_HALF_LIFE_DAYS}-set1-bo3-v1`
  if (mode === 'inactivity') return `tennis-elo-k32-1500-h${TENNIS_INACTIVITY_HALF_LIFE_DAYS}-set1-bo3-v1`
  return `tennis-elo-k32-1500-raw-set1-bo3-v1`
}

export const runTennisDiscipline = (
  discipline: TennisDiscipline,
  matches: TennisBacktestMatch[],
): TennisDisciplineResult => {
  const ordered = [...matches].sort((left, right) =>
    left.playedOn.localeCompare(right.playedOn) || left.matchId.localeCompare(right.matchId),
  )

  const trainEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.7) - 1)]?.playedOn ?? '1970-01-01'
  const validEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.85) - 1)]?.playedOn ?? trainEnd

  const state = new Map<string, PlayerState>()
  const matchSnapshots: Snapshot[] = []
  const set1Snapshots: Snapshot[] = []
  const pointsSnapshots: PointsSnapshot[] = []
  const counts = emptyCounts()

  const readState = (playerId: string) => {
    const existing = state.get(playerId)
    if (existing) return existing
    const created: PlayerState = {
      elo: TENNIS_INITIAL_ELO,
      matchCount: 0,
      set1Count: 0,
      lastPlayedOn: null,
      set1History: [],
      surfacePreference: defaultSurfacePreference(),
    }
    state.set(playerId, created)
    return created
  }

  for (const match of ordered) {
    const sideA = readState(match.sideAId)
    const sideB = readState(match.sideBId)
    const split = splitFor(match.playedOn, trainEnd, validEnd)

    const eloDiffRaw = sideA.elo - sideB.elo
    const ratingAIdle = effectiveRating(sideA.elo, sideA.matchCount, sideA.lastPlayedOn, match.playedOn, 'inactivity')
    const ratingBIdle = effectiveRating(sideB.elo, sideB.matchCount, sideB.lastPlayedOn, match.playedOn, 'inactivity')
    const eloDiffIdle = ratingAIdle - ratingBIdle

    const pMatchRaw = expectedScoreWithSurface(
      sideA.elo,
      sideB.elo,
      match.surface,
      sideA.surfacePreference,
      sideB.surfacePreference,
    )
    const pMatchIdle = expectedScoreWithSurface(
      ratingAIdle,
      ratingBIdle,
      match.surface,
      sideA.surfacePreference,
      sideB.surfacePreference,
    )

    const snapshotBase = {
      matchId: match.matchId,
      playedOn: match.playedOn,
      split,
      pMatchRaw,
      pMatchIdle,
      eloDiffRaw,
      eloDiffIdle,
    }

    if (match.sets.length > 0) {
      pointsSnapshots.push({
        ...snapshotBase,
        sets: match.sets,
        matchComplete: match.includeMatch && match.sideAWonMatch !== null,
      })
    }

    if (match.includeMatch && match.sideAWonMatch !== null) {
      counts[split].match += 1
      matchSnapshots.push({
        ...snapshotBase,
        y: match.sideAWonMatch ? 1 : 0,
      })
      const next = updateElo(sideA.elo, sideB.elo, match.sideAWonMatch)
      sideA.elo = next.ratingA
      sideB.elo = next.ratingB
      sideA.matchCount += 1
      sideB.matchCount += 1
      if (match.surface) {
        const bump = (pref: SurfacePreference, won: boolean): SurfacePreference => ({
          ...pref,
          [match.surface!]: Math.min(1.3, Math.max(0.7, pref[match.surface!] + (won ? 0.03 : -0.03))),
        })
        sideA.surfacePreference = bump(sideA.surfacePreference, match.sideAWonMatch)
        sideB.surfacePreference = bump(sideB.surfacePreference, !match.sideAWonMatch)
      }
    }

    if (match.includeSet1 && match.sideAWonSet1 !== null) {
      counts[split].set1 += 1
      set1Snapshots.push({
        ...snapshotBase,
        y: match.sideAWonSet1 ? 1 : 0,
      })
      sideA.set1History.push(match.sideAWonSet1 ? 1 : 0)
      sideB.set1History.push(match.sideAWonSet1 ? 0 : 1)
      sideA.set1Count += 1
      sideB.set1Count += 1
    }

    sideA.lastPlayedOn = match.playedOn
    sideB.lastPlayedOn = match.playedOn
  }

  const validMatch = matchSnapshots.filter(row => row.split === 'valid')
  const validationMatchRaw = averageLogLoss(validMatch, row => row.pMatchRaw, row => row.y)
  const validationMatchIdle = averageLogLoss(validMatch, row => row.pMatchIdle, row => row.y)

  const shrinkMode: 'raw' | 'inactivity' | 'full' =
    validationMatchIdle !== null && validationMatchRaw !== null && validationMatchIdle < validationMatchRaw
      ? 'inactivity'
      : 'raw'

  const modelVersion = buildTennisModelVersion(shrinkMode)

  const trainPoints = pointsSnapshots.filter(row => row.split === 'train')
  const rallyRows: TennisRallyMatchRow[] = trainPoints.map(row => ({
    eloDiff: shrinkMode === 'inactivity' ? row.eloDiffIdle : row.eloDiffRaw,
    sets: row.sets.map(s => ({ gamesA: s.gamesA, gamesB: s.gamesB })),
  }))
  const rally = fitTennisRallyModel(rallyRows)

  const testMatch = matchSnapshots.filter(row => row.split === 'test')
  const testSet1 = set1Snapshots.filter(row => row.split === 'test')

  const pMatch = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pMatchIdle : row.pMatchRaw

  const testPoints = pointsSnapshots.filter(row => row.split === 'test' && row.matchComplete)
  const frequency = Object.fromEntries(TENNIS_CORRECT_SCORES.map((score) => {
    const count = trainPoints.filter(row => row.matchComplete && correctScoreOf(row.sets) === score).length
    return [score, (count + 1) / (trainPoints.filter(r => r.matchComplete).length + TENNIS_CORRECT_SCORES.length)]
  })) as Record<TennisCorrectScore, number>

  const evaluatedPoints = testPoints.map((row) => {
    const distribution = tennisMatchDistribution(matchProbabilityToPoint(pMatch(row)), rally.sigma)
    const total = row.sets.reduce((sum, set) => sum + set.gamesA + set.gamesB, 0)
    const margin = row.sets.reduce((sum, set) => sum + set.gamesA - set.gamesB, 0)
    return { distribution, total, margin, score: correctScoreOf(row.sets) }
  })

  const totalsTest: TennisPointsMarketTest = {
    n: evaluatedPoints.length,
    logLoss: mean(evaluatedPoints.map(row => {
      const fair = fairLine(row.distribution.total)
      const p = probabilityAbove(row.distribution.total, fair)
      const y = row.total > fair ? 1 : 0
      return logLoss(p, y)
    })),
    baselineLogLoss: mean(evaluatedPoints.map(row => {
      const fair = fairLine(row.distribution.total)
      return logLoss(0.5, row.total > fair ? 1 : 0)
    })),
    calibration: calibrationBins(evaluatedPoints.map(row => {
      const fair = fairLine(row.distribution.total)
      return { p: probabilityAbove(row.distribution.total, fair), y: row.total > fair ? 1 : 0 }
    })),
  }

  const handicapTest: TennisPointsMarketTest = {
    n: evaluatedPoints.length,
    logLoss: mean(evaluatedPoints.map(row => {
      const fair = -fairLine(row.distribution.margin)
      const p = coversHandicap(row.distribution.margin, fair)
      const y = row.margin + fair > 0 ? 1 : 0
      return logLoss(p, y)
    })),
    baselineLogLoss: mean(evaluatedPoints.map(row => {
      const fair = -fairLine(row.distribution.margin)
      return logLoss(0.5, row.margin + fair > 0 ? 1 : 0)
    })),
    calibration: calibrationBins(evaluatedPoints.map(row => {
      const fair = -fairLine(row.distribution.margin)
      return { p: coversHandicap(row.distribution.margin, fair), y: row.margin + fair > 0 ? 1 : 0 }
    })),
  }

  const correctScoreTest: TennisPointsMarketTest = {
    n: evaluatedPoints.length,
    logLoss: mean(evaluatedPoints.map(row => -Math.log(Math.max(1e-6, row.distribution.correctScore[row.score])))),
    baselineLogLoss: mean(evaluatedPoints.map(row => -Math.log(frequency[row.score]))),
    calibration: calibrationBins(evaluatedPoints.flatMap(row =>
      TENNIS_CORRECT_SCORES.map(score => ({
        p: row.distribution.correctScore[score],
        y: row.score === score ? 1 : 0,
      }))
    )),
  }

  const predictions: TennisPredictionRow[] = [
    ...matchSnapshots.map(row => ({
      matchId: row.matchId,
      marketType: 'match_winner' as const,
      modelVersion,
      pSideA: pMatch(row),
      featureAsOf: row.playedOn,
      split: row.split,
    })),
    ...set1Snapshots.map(row => ({
      matchId: row.matchId,
      marketType: 'set1_winner' as const,
      modelVersion,
      pSideA: matchProbabilityToSet1(pMatch(row)),
      featureAsOf: row.playedOn,
      split: row.split,
    })),
  ]

  return {
    discipline,
    modelVersion,
    set1Method: 'bo3',
    dataThrough: ordered[ordered.length - 1]?.playedOn ?? '',
    predictions,
    ratings: [...state.entries()].map(([playerId, player]) => ({
      discipline,
      playerId,
      elo: player.elo,
      matchCount: player.matchCount,
      set1Count: player.set1Count,
      lastPlayedOn: player.lastPlayedOn,
      surfacePreference: player.surfacePreference,
      set1Recent: player.set1History.slice(-10),
    })),
    payload: {
      trainEnd,
      validEnd,
      counts,
      shrink: {
        enabled: shrinkMode !== 'raw',
        mode: shrinkMode,
        samplePrior: TENNIS_SAMPLE_PRIOR,
        halfLifeDays: TENNIS_INACTIVITY_HALF_LIFE_DAYS,
      },
      validation: {
        matchEloRaw: validationMatchRaw,
        matchEloIdle: validationMatchIdle,
        matchEloEff: null,
      },
      test: {
        match: {
          n: testMatch.length,
          logLoss: averageLogLoss(testMatch, pMatch, row => row.y),
          brier: averageBrier(testMatch, pMatch, row => row.y),
          baselineLogLoss: averageLogLoss(testMatch, () => 0.5, row => row.y),
          calibration: calibrationBins(testMatch.map(row => ({ p: pMatch(row), y: row.y }))),
        },
        set1: {
          n: testSet1.length,
          logLoss: averageLogLoss(testSet1, pMatch, row => row.y),
          brier: averageBrier(testSet1, pMatch, row => row.y),
          calibration: calibrationBins(testSet1.map(row => ({ p: pMatch(row), y: row.y }))),
        },
        totals: totalsTest,
        handicap: handicapTest,
        correctScore: correctScoreTest,
      },
      rally,
      calibration: {
        match: calibrationBins(matchSnapshots.filter(r => r.split === 'train').map(row => ({ p: pMatch(row), y: row.y }))),
        set1: calibrationBins(set1Snapshots.filter(r => r.split === 'train').map(row => ({ p: pMatch(row), y: row.y }))),
        totals: totalsTest.calibration,
        handicap: handicapTest.calibration,
        correctScore: correctScoreTest.calibration,
      },
    },
  }
}

export const runTennisBacktest = (matches: TennisBacktestMatch[]) => {
  const disciplines: TennisDiscipline[] = ['ATP', 'WTA']
  return disciplines.map(discipline =>
    runTennisDiscipline(discipline, matches.filter(match => match.discipline === discipline)),
  )
}
