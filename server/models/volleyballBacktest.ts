/**
 * 排球回測模組
 *
 * 功能：
 * 1. 從歷史資料建立 Elo 評分系統
 * 2. 訓練每球得分模型
 * 3. 評估模型效能並校準
 * 4. 儲存模型參數與預測結果
 */

import type { VolleyballDiscipline, Split } from '../../shared/types'
import { VOLLEYBALL_CORRECT_SCORES, type VolleyballCorrectScore } from '../../shared/types'
import {
  VOLLEYBALL_INITIAL_ELO,
  VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS,
  VOLLEYBALL_SAMPLE_PRIOR,
} from './constants'
import { effectiveRating, updateEloWithFactors, expectedScoreWithFactors, type HomeAdvantageMode } from './volleyballElo'
import {
  volleyballMatchDistribution,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  probabilityAbove,
  coversHandicap,
  fairLine,
  fitVolleyballRallyModel,
  type VolleyballRallyModel,
  type VolleyballRallyMatchRow,
} from './volleyballRally'
import { calibrationBins, logLoss, type CalibrationBin } from './game1'

export type VolleyballBacktestSet = {
  pointsA: number
  pointsB: number
  isLegal: boolean
}

export type VolleyballBacktestMatch = {
  matchId: string
  discipline: VolleyballDiscipline
  playedOn: string
  sideAId: string
  sideBId: string
  sideAIsHome: boolean
  homeAdvantageMode: HomeAdvantageMode
  sideARosterStrength: number
  sideBRosterStrength: number
  includeMatch: boolean
  includeSet1: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  sets: VolleyballBacktestSet[]
}

export type VolleyballStoredRating = {
  discipline: VolleyballDiscipline
  teamId: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  homeAdvantage: number
  rosterStrength: number
  set1Recent: number[]
}

export type VolleyballPointsMarketTest = {
  n: number
  logLoss: number | null
  baselineLogLoss: number | null
  fairLineRate?: number | null
  calibration: CalibrationBin[]
}

export type VolleyballModelPayload = {
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
    totals?: VolleyballPointsMarketTest
    handicap?: VolleyballPointsMarketTest
    correctScore?: VolleyballPointsMarketTest
  }
  rally?: VolleyballRallyModel
  calibration?: {
    match?: CalibrationBin[]
    set1?: CalibrationBin[]
    totals?: CalibrationBin[]
    handicap?: CalibrationBin[]
    correctScore?: CalibrationBin[]
  }
}

export type VolleyballPredictionRow = {
  matchId: string
  marketType: 'match_winner' | 'set1_winner'
  modelVersion: string
  pSideA: number
  featureAsOf: string
  split: Split
}

export type VolleyballDisciplineResult = {
  discipline: VolleyballDiscipline
  modelVersion: string
  set1Method: 'bo5'
  payload: VolleyballModelPayload
  dataThrough: string
  predictions: VolleyballPredictionRow[]
  ratings: VolleyballStoredRating[]
}

type TeamState = {
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  set1History: number[]
  homeAdvantage: number
  rosterStrength: number
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
  sets: VolleyballBacktestSet[]
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

const correctScoreOf = (sets: VolleyballBacktestSet[]): VolleyballCorrectScore => {
  const winsA = sets.filter(set => set.pointsA > set.pointsB).length
  const winsB = sets.length - winsA
  return `${winsA}:${winsB}` as VolleyballCorrectScore
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

export const buildVolleyballModelVersion = (mode: 'raw' | 'inactivity' | 'full') => {
  if (mode === 'full') return `volleyball-elo-k32-1500-n${VOLLEYBALL_SAMPLE_PRIOR}-h${VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS}-set1-bo5-v1`
  if (mode === 'inactivity') return `volleyball-elo-k32-1500-h${VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS}-set1-bo5-v1`
  return `volleyball-elo-k32-1500-raw-set1-bo5-v1`
}

export const runVolleyballDiscipline = (
  discipline: VolleyballDiscipline,
  matches: VolleyballBacktestMatch[],
): VolleyballDisciplineResult => {
  const ordered = [...matches].sort((left, right) =>
    left.playedOn.localeCompare(right.playedOn) || left.matchId.localeCompare(right.matchId),
  )

  const trainEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.7) - 1)]?.playedOn ?? '1970-01-01'
  const validEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.85) - 1)]?.playedOn ?? trainEnd

  const state = new Map<string, TeamState>()
  const matchSnapshots: Snapshot[] = []
  const set1Snapshots: Snapshot[] = []
  const pointsSnapshots: PointsSnapshot[] = []
  const counts = emptyCounts()

  const readState = (teamId: string, defaultRoster = 1.0) => {
    const existing = state.get(teamId)
    if (existing) return existing
    const created: TeamState = {
      elo: VOLLEYBALL_INITIAL_ELO,
      matchCount: 0,
      set1Count: 0,
      lastPlayedOn: null,
      set1History: [],
      homeAdvantage: 0,
      rosterStrength: defaultRoster,
    }
    state.set(teamId, created)
    return created
  }

  for (const match of ordered) {
    const sideA = readState(match.sideAId, match.sideARosterStrength)
    const sideB = readState(match.sideBId, match.sideBRosterStrength)
    const split = splitFor(match.playedOn, trainEnd, validEnd)

    const eloDiffRaw = sideA.elo - sideB.elo
    const ratingAIdle = effectiveRating(sideA.elo, sideA.matchCount, sideA.lastPlayedOn, match.playedOn, 'inactivity')
    const ratingBIdle = effectiveRating(sideB.elo, sideB.matchCount, sideB.lastPlayedOn, match.playedOn, 'inactivity')
    const eloDiffIdle = ratingAIdle - ratingBIdle

    const pMatchRaw = expectedScoreWithFactors(
      sideA.elo, sideB.elo,
      match.sideAIsHome,
      match.homeAdvantageMode,
      sideA.rosterStrength,
      sideB.rosterStrength,
    )
    const pMatchIdle = expectedScoreWithFactors(
      ratingAIdle, ratingBIdle,
      match.sideAIsHome,
      match.homeAdvantageMode,
      sideA.rosterStrength,
      sideB.rosterStrength,
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
      const next = updateEloWithFactors(
        sideA.elo,
        sideB.elo,
        match.sideAWonMatch,
        match.sideAIsHome,
        match.homeAdvantageMode,
        sideA.rosterStrength,
        sideB.rosterStrength,
      )
      sideA.elo = next.ratingA
      sideB.elo = next.ratingB
      sideA.matchCount += 1
      sideB.matchCount += 1
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
    sideA.rosterStrength = match.sideARosterStrength
    sideB.rosterStrength = match.sideBRosterStrength
  }

  const validMatch = matchSnapshots.filter(row => row.split === 'valid')
  const validationMatchRaw = averageLogLoss(validMatch, row => row.pMatchRaw, row => row.y)
  const validationMatchIdle = averageLogLoss(validMatch, row => row.pMatchIdle, row => row.y)

  const shrinkMode: 'raw' | 'inactivity' | 'full' =
    validationMatchIdle !== null && validationMatchRaw !== null && validationMatchIdle < validationMatchRaw
      ? 'inactivity'
      : 'raw'

  const modelVersion = buildVolleyballModelVersion(shrinkMode)

  const trainPoints = pointsSnapshots.filter(row => row.split === 'train')
  const rallyRows: VolleyballRallyMatchRow[] = trainPoints.map(row => ({
    eloDiff: shrinkMode === 'inactivity' ? row.eloDiffIdle : row.eloDiffRaw,
    homeFactor: 0,
    rosterDiff: 0,
    sets: row.sets.map(s => ({ pointsA: s.pointsA, pointsB: s.pointsB })),
  }))
  const rally = fitVolleyballRallyModel(rallyRows)

  const testMatch = matchSnapshots.filter(row => row.split === 'test')
  const testSet1 = set1Snapshots.filter(row => row.split === 'test')

  const pMatch = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pMatchIdle : row.pMatchRaw

  const testPoints = pointsSnapshots.filter(row => row.split === 'test' && row.matchComplete)
  const frequency = Object.fromEntries(VOLLEYBALL_CORRECT_SCORES.map((score) => {
    const count = trainPoints.filter(row => row.matchComplete && correctScoreOf(row.sets) === score).length
    return [score, (count + 1) / (trainPoints.filter(r => r.matchComplete).length + VOLLEYBALL_CORRECT_SCORES.length)]
  })) as Record<VolleyballCorrectScore, number>

  const pSet1 = (row: Snapshot) => matchProbabilityToSet1(pMatch(row), rally.sigma)

  const evaluatedPoints = testPoints.map((row) => {
    const rallyWin = matchProbabilityToPoint(pMatch(row), rally.sigma)
    const distribution = volleyballMatchDistribution(rallyWin, rally.sigma, rally.tau ?? 0)
    const total = row.sets.reduce((sum, set) => sum + set.pointsA + set.pointsB, 0)
    const margin = row.sets.reduce((sum, set) => sum + set.pointsA - set.pointsB, 0)
    return { distribution, total, margin, score: correctScoreOf(row.sets) }
  })

  const totalsTest: VolleyballPointsMarketTest = {
    n: evaluatedPoints.length,
    logLoss: mean(evaluatedPoints.map(row => {
      const fair = fairLine(row.distribution.total)
      const p = probabilityAbove(row.distribution.total, fair)
      const y = row.total > fair ? 1 : 0
      return logLoss(p, y)
    })),
    baselineLogLoss: mean(evaluatedPoints.map(row => logLoss(0.5, row.total > fairLine(row.distribution.total) ? 1 : 0))),
    calibration: calibrationBins(evaluatedPoints.map(row => {
      const fair = fairLine(row.distribution.total)
      return { p: probabilityAbove(row.distribution.total, fair), y: row.total > fair ? 1 : 0 }
    })),
  }

  const handicapTest: VolleyballPointsMarketTest = {
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

  const correctScoreTest: VolleyballPointsMarketTest = {
    n: evaluatedPoints.length,
    logLoss: mean(evaluatedPoints.map(row => -Math.log(Math.max(1e-6, row.distribution.correctScore[row.score])))),
    baselineLogLoss: mean(evaluatedPoints.map(row => -Math.log(frequency[row.score]))),
    calibration: calibrationBins(evaluatedPoints.flatMap(row =>
      VOLLEYBALL_CORRECT_SCORES.map(score => ({
        p: row.distribution.correctScore[score],
        y: row.score === score ? 1 : 0,
      }))
    )),
  }

  const predictions: VolleyballPredictionRow[] = [
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
      pSideA: pSet1(row),
      featureAsOf: row.playedOn,
      split: row.split,
    })),
  ]

  return {
    discipline,
    modelVersion,
    set1Method: 'bo5',
    dataThrough: ordered[ordered.length - 1]?.playedOn ?? '',
    predictions,
    ratings: [...state.entries()].map(([teamId, team]) => ({
      discipline,
      teamId,
      elo: team.elo,
      matchCount: team.matchCount,
      set1Count: team.set1Count,
      lastPlayedOn: team.lastPlayedOn,
      homeAdvantage: team.homeAdvantage,
      rosterStrength: team.rosterStrength,
      set1Recent: team.set1History.slice(-10),
    })),
    payload: {
      trainEnd,
      validEnd,
      counts,
      shrink: {
        enabled: shrinkMode !== 'raw',
        mode: shrinkMode,
        samplePrior: VOLLEYBALL_SAMPLE_PRIOR,
        halfLifeDays: VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS,
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
          logLoss: averageLogLoss(testSet1, pSet1, row => row.y),
          brier: averageBrier(testSet1, pSet1, row => row.y),
          calibration: calibrationBins(testSet1.map(row => ({ p: pSet1(row), y: row.y }))),
        },
        totals: totalsTest,
        handicap: handicapTest,
        correctScore: correctScoreTest,
      },
      rally,
      calibration: {
        match: calibrationBins(matchSnapshots.filter(r => r.split === 'train').map(row => ({ p: pMatch(row), y: row.y }))),
        set1: calibrationBins(set1Snapshots.filter(r => r.split === 'train').map(row => ({ p: pSet1(row), y: row.y }))),
      },
    },
  }
}

export const runVolleyballBacktest = (matches: VolleyballBacktestMatch[]) => {
  const disciplines: VolleyballDiscipline[] = ['M', 'W']
  return disciplines.map(discipline =>
    runVolleyballDiscipline(discipline, matches.filter(match => match.discipline === discipline)),
  )
}
