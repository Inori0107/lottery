import type { Split, TennisDiscipline } from '../../shared/types'
import {
  TENNIS_INACTIVITY_HALF_LIFE_DAYS,
  TENNIS_INITIAL_ELO,
  TENNIS_SAMPLE_PRIOR,
} from './constants'
import { calibrationBins, logLoss } from './game1'
import { effectiveRating, expectedScore, updateElo, type ShrinkMode } from './tennisElo'
import {
  fitTennisRallyModel,
  matchProbabilityToSet1,
  type TennisRallyModel,
} from './tennisRally'

export type TennisBacktestSet = {
  gamesA: number
  gamesB: number
  isLegal: boolean
}

export type TennisBacktestMatch = {
  matchId: string
  discipline: TennisDiscipline
  tournament: string
  playedOn: string
  sideAId: string
  sideBId: string
  includeMatch: boolean
  includeSet1: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  sets: TennisBacktestSet[]
  bestOf: 3 | 5
}

export type TennisStoredRating = {
  discipline: TennisDiscipline
  playerId: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1Recent: number[]
}

export type TennisModelPayload = {
  trainEnd: string
  validEnd: string
  counts: Record<Split, { match: number, set1: number }>
  shrink: {
    enabled: boolean
    mode: ShrinkMode
    samplePrior: number
    halfLifeDays: number
  }
  validation: {
    matchEloRaw: number | null
    matchEloIdle: number | null
  }
  test: {
    match: { n: number, logLoss: number | null, brier: number | null }
    set1: { n: number, logLoss: number | null, brier: number | null }
  }
  rally?: TennisRallyModel
  calibration?: {
    match?: ReturnType<typeof calibrationBins>
    set1?: ReturnType<typeof calibrationBins>
  }
}

export type TennisDisciplineResult = {
  discipline: TennisDiscipline
  modelVersion: string
  set1Method: 'bo3'
  payload: TennisModelPayload
  dataThrough: string
  ratings: TennisStoredRating[]
}

type PlayerState = {
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1History: number[]
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
  sets: TennisBacktestSet[]
}

const mean = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null

const averageLogLoss = (rows: Snapshot[], probability: (row: Snapshot) => number) =>
  mean(rows.map(row => logLoss(probability(row), row.y)))

const averageBrier = (rows: Snapshot[], probability: (row: Snapshot) => number) =>
  mean(rows.map(row => (probability(row) - row.y) ** 2))

const splitFor = (playedOn: string, trainEnd: string, validEnd: string): Split => {
  if (playedOn <= trainEnd) return 'train'
  if (playedOn <= validEnd) return 'valid'
  return 'test'
}

export const buildTennisModelVersion = (mode: ShrinkMode) => {
  if (mode === 'inactivity') return `tennis-elo-k32-1500-h${TENNIS_INACTIVITY_HALF_LIFE_DAYS}-set1-bo3-v1`
  return 'tennis-elo-k32-1500-raw-set1-bo3-v1'
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
  const counts: Record<Split, { match: number, set1: number }> = {
    train: { match: 0, set1: 0 },
    valid: { match: 0, set1: 0 },
    test: { match: 0, set1: 0 },
  }

  const readState = (playerId: string) => {
    const existing = state.get(playerId)
    if (existing) return existing
    const created: PlayerState = {
      elo: TENNIS_INITIAL_ELO,
      matchCount: 0,
      set1Count: 0,
      lastPlayedOn: null,
      set1History: [],
    }
    state.set(playerId, created)
    return created
  }

  for (const match of ordered) {
    const sideA = readState(match.sideAId)
    const sideB = readState(match.sideBId)
    const split = splitFor(match.playedOn, trainEnd, validEnd)
    const ratingAIdle = effectiveRating(sideA.elo, sideA.matchCount, sideA.lastPlayedOn, match.playedOn, 'inactivity')
    const ratingBIdle = effectiveRating(sideB.elo, sideB.matchCount, sideB.lastPlayedOn, match.playedOn, 'inactivity')
    const snapshotBase = {
      matchId: match.matchId,
      playedOn: match.playedOn,
      split,
      pMatchRaw: expectedScore(sideA.elo, sideB.elo),
      pMatchIdle: expectedScore(ratingAIdle, ratingBIdle),
      eloDiffRaw: sideA.elo - sideB.elo,
      eloDiffIdle: ratingAIdle - ratingBIdle,
      sets: match.sets,
    }

    if (match.includeMatch && match.sideAWonMatch !== null) {
      counts[split].match += 1
      matchSnapshots.push({ ...snapshotBase, y: match.sideAWonMatch ? 1 : 0 })
      const next = updateElo(sideA.elo, sideB.elo, match.sideAWonMatch)
      sideA.elo = next.ratingA
      sideB.elo = next.ratingB
      sideA.matchCount += 1
      sideB.matchCount += 1
    }
    if (match.includeSet1 && match.sideAWonSet1 !== null) {
      counts[split].set1 += 1
      set1Snapshots.push({ ...snapshotBase, y: match.sideAWonSet1 ? 1 : 0 })
      sideA.set1History.push(match.sideAWonSet1 ? 1 : 0)
      sideB.set1History.push(match.sideAWonSet1 ? 0 : 1)
      sideA.set1Count += 1
      sideB.set1Count += 1
    }
    sideA.lastPlayedOn = match.playedOn
    sideB.lastPlayedOn = match.playedOn
  }

  const validMatch = matchSnapshots.filter(row => row.split === 'valid')
  const validationMatchRaw = averageLogLoss(validMatch, row => row.pMatchRaw)
  const validationMatchIdle = averageLogLoss(validMatch, row => row.pMatchIdle)
  const shrinkMode: ShrinkMode =
    validationMatchIdle !== null && validationMatchRaw !== null && validationMatchIdle < validationMatchRaw
      ? 'inactivity'
      : 'raw'
  const modelVersion = buildTennisModelVersion(shrinkMode)
  const pMatch = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pMatchIdle : row.pMatchRaw
  const rally = fitTennisRallyModel(
    matchSnapshots.filter(row => row.split === 'train').map(row => ({
      eloDiff: shrinkMode === 'inactivity' ? row.eloDiffIdle : row.eloDiffRaw,
      sets: row.sets.map(set => ({ gamesA: set.gamesA, gamesB: set.gamesB })),
    })),
  )
  const pSet1 = (row: Snapshot) => matchProbabilityToSet1(pMatch(row), 3)
  const testMatch = matchSnapshots.filter(row => row.split === 'test')
  const testSet1 = set1Snapshots.filter(row => row.split === 'test')

  return {
    discipline,
    modelVersion,
    set1Method: 'bo3',
    dataThrough: ordered[ordered.length - 1]?.playedOn ?? '',
    ratings: [...state.entries()].map(([playerId, player]) => ({
      discipline,
      playerId,
      elo: player.elo,
      matchCount: player.matchCount,
      set1Count: player.set1Count,
      lastPlayedOn: player.lastPlayedOn,
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
      },
      test: {
        match: {
          n: testMatch.length,
          logLoss: averageLogLoss(testMatch, pMatch),
          brier: averageBrier(testMatch, pMatch),
        },
        set1: {
          n: testSet1.length,
          logLoss: averageLogLoss(testSet1, pSet1),
          brier: averageBrier(testSet1, pSet1),
        },
      },
      rally,
      calibration: {
        match: calibrationBins(matchSnapshots.filter(row => row.split === 'train').map(row => ({ p: pMatch(row), y: row.y }))),
        set1: calibrationBins(set1Snapshots.filter(row => row.split === 'train').map(row => ({ p: pSet1(row), y: row.y }))),
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
