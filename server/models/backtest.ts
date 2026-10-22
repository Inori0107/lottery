import type { Discipline, Game1Method, Split } from '../../shared/types'
import { INACTIVITY_HALF_LIFE_DAYS, SAMPLE_PRIOR } from './constants'
import {
  averageBrier,
  averageLogLoss,
  buildBins,
  calibrationBins,
  clampGame1ToMatch,
  fitLogistic,
  logLoss,
  matchProbabilityToGame1,
  mean,
  predictBin,
  predictLogistic,
  selectGame1Method,
  shrunkWinRate,
  type CalibrationBin,
  type LabeledRow,
  type ProbabilityBin,
  type LogisticCoefficients,
} from './game1'
import { effectiveRating, expectedScore, updateElo, INITIAL_ELO, type ShrinkMode } from './elo'
import {
  CORRECT_SCORES,
  coversHandicap,
  fairLine,
  fitRallyModel,
  linesWithin,
  probabilityAbove,
  rallyMatchDistribution,
  type CorrectScore,
  type RallyModel,
} from './rally'

export type BacktestGame = { pointsA: number, pointsB: number }

export type BacktestMatch = {
  matchId: string
  discipline: Discipline
  playedOn: string
  sideAId: string
  sideBId: string
  includeMatch: boolean
  includeGame1: boolean
  sideAWonMatch: boolean | null
  sideAWonGame1: boolean | null
  games: BacktestGame[]
}

export type PointsMarketTest = {
  n: number
  logLoss: number | null
  baselineLogLoss: number | null
  fairLineRate?: number | null
  calibration: CalibrationBin[]
}

export type StoredRating = {
  discipline: Discipline
  playerId: string
  elo: number
  matchCount: number
  game1Count: number
  lastPlayedOn: string | null
  game1Recent: number[]
}

export type PredictionRow = {
  matchId: string
  marketType: 'match_winner' | 'game1_winner'
  modelVersion: string
  pSideA: number
  featureAsOf: string
  split: Split
}

export type ModelPayload = {
  coefficients: LogisticCoefficients
  bins: ProbabilityBin[]
  trainEnd: string
  validEnd: string
  counts: Record<Split, { match: number, game1: number }>
  shrink: {
    enabled: boolean
    mode: ShrinkMode
    samplePrior: number
    halfLifeDays: number
  }
  validation: {
    logistic: number | null
    bins: number | null
    bo3: number | null
    matchElo: number | null
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
    game1: {
      logLoss: number | null
      brier: number | null
      matchEloLogLoss: number | null
      n: number
      calibration: CalibrationBin[]
    }
    totals?: PointsMarketTest
    handicap?: PointsMarketTest
    correctScore?: PointsMarketTest
  }
  rally?: RallyModel
}

export type DisciplineResult = {
  discipline: Discipline
  modelVersion: string
  game1Method: Game1Method
  payload: ModelPayload
  dataThrough: string
  predictions: PredictionRow[]
  ratings: StoredRating[]
}

type PlayerState = {
  elo: number
  matchCount: number
  game1Count: number
  lastPlayedOn: string | null
  game1History: number[]
}

type Snapshot = {
  matchId: string
  playedOn: string
  split: Split
  y: number
  pMatchRaw: number
  pMatchIdle: number
  pMatchEff: number
  eloDiffRaw: number
  eloDiffIdle: number
  eloDiffEff: number
  formDiff: number
}

type PointsSnapshot = Omit<Snapshot, 'y'> & {
  games: BacktestGame[]
  matchComplete: boolean
}

const CALIBRATION_LINE_LOW = 0.15
const CALIBRATION_LINE_HIGH = 0.85

const correctScoreOf = (games: BacktestGame[]): CorrectScore => {
  const winsA = games.filter(game => game.pointsA > game.pointsB).length
  const winsB = games.length - winsA
  return `${winsA}:${winsB}` as CorrectScore
}

const evaluateTwoWayLines = (
  rows: Array<{ lines: number[], probability: (line: number) => number, outcome: (line: number) => number, fair: number }>,
): PointsMarketTest => {
  const pairs = rows.flatMap(row => row.lines.map(line => ({ p: row.probability(line), y: row.outcome(line) })))
  return {
    n: rows.length,
    logLoss: mean(pairs.map(pair => logLoss(pair.p, pair.y))),
    baselineLogLoss: mean(pairs.map(pair => logLoss(0.5, pair.y))),
    fairLineRate: mean(rows.map(row => row.outcome(row.fair))),
    calibration: calibrationBins(pairs),
  }
}

const evaluatePointsMarkets = (
  train: PointsSnapshot[],
  test: PointsSnapshot[],
  rally: RallyModel,
  mode: ShrinkMode,
) => {
  const completedTrain = train.filter(row => row.matchComplete)
  const frequency = Object.fromEntries(CORRECT_SCORES.map((score) => {
    const count = completedTrain.filter(row => correctScoreOf(row.games) === score).length
    return [score, (count + 1) / (completedTrain.length + CORRECT_SCORES.length)]
  })) as Record<CorrectScore, number>
  const evaluated = test.filter(row => row.matchComplete).map((row) => {
    const distribution = rallyMatchDistribution(rally, eloDiffFor(row, mode))
    const total = row.games.reduce((sum, game) => sum + game.pointsA + game.pointsB, 0)
    const margin = row.games.reduce((sum, game) => sum + game.pointsA - game.pointsB, 0)
    return { distribution, total, margin, score: correctScoreOf(row.games) }
  })

  const totals = evaluateTwoWayLines(evaluated.map(row => ({
    lines: linesWithin(row.distribution.total, CALIBRATION_LINE_LOW, CALIBRATION_LINE_HIGH),
    probability: (line: number) => probabilityAbove(row.distribution.total, line),
    outcome: (line: number) => (row.total > line ? 1 : 0),
    fair: fairLine(row.distribution.total),
  })))
  const handicap = evaluateTwoWayLines(evaluated.map(row => ({
    lines: linesWithin(row.distribution.margin, CALIBRATION_LINE_LOW, CALIBRATION_LINE_HIGH).map(line => -line),
    probability: (handicapLine: number) => coversHandicap(row.distribution.margin, handicapLine),
    outcome: (handicapLine: number) => (row.margin + handicapLine > 0 ? 1 : 0),
    fair: -fairLine(row.distribution.margin),
  })))
  const correctScore: PointsMarketTest = {
    n: evaluated.length,
    logLoss: mean(evaluated.map(row => -Math.log(Math.max(1e-6, row.distribution.correctScore[row.score])))),
    baselineLogLoss: mean(evaluated.map(row => -Math.log(frequency[row.score]))),
    calibration: calibrationBins(evaluated.flatMap(row => CORRECT_SCORES.map(score => ({
      p: row.distribution.correctScore[score],
      y: row.score === score ? 1 : 0,
    })))),
  }

  return { totals, handicap, correctScore }
}

const splitFor = (playedOn: string, trainEnd: string, validEnd: string): Split => {
  if (playedOn <= trainEnd) return 'train'
  if (playedOn <= validEnd) return 'valid'
  return 'test'
}

const emptyCounts = (): Record<Split, { match: number, game1: number }> => ({
  train: { match: 0, game1: 0 },
  valid: { match: 0, game1: 0 },
  test: { match: 0, game1: 0 },
})

const pMatchFor = (row: Snapshot, mode: ShrinkMode) => {
  if (mode === 'full') return row.pMatchEff
  if (mode === 'inactivity') return row.pMatchIdle
  return row.pMatchRaw
}

const eloDiffFor = (row: Pick<Snapshot, 'eloDiffRaw' | 'eloDiffIdle' | 'eloDiffEff'>, mode: ShrinkMode) => {
  if (mode === 'full') return row.eloDiffEff
  if (mode === 'inactivity') return row.eloDiffIdle
  return row.eloDiffRaw
}

const toLabeled = (row: Snapshot, mode: ShrinkMode): LabeledRow => ({
  eloDiff: eloDiffFor(row, mode),
  formDiff: row.formDiff,
  y: row.y,
  pMatch: pMatchFor(row, mode),
})

export const selectShrinkMode = (
  rawLogLoss: number,
  idleLogLoss: number,
  fullLogLoss: number,
): ShrinkMode => {
  const options: Array<{ mode: ShrinkMode, loss: number }> = [
    { mode: 'raw', loss: rawLogLoss },
    { mode: 'inactivity', loss: idleLogLoss },
    { mode: 'full', loss: fullLogLoss },
  ]
  options.sort((left, right) => left.loss - right.loss || left.mode.localeCompare(right.mode))
  return options[0]?.mode ?? 'raw'
}

export const buildModelVersion = (mode: ShrinkMode, game1Method: Game1Method) => {
  if (mode === 'full') return `elo-k32-1500-n${SAMPLE_PRIOR}-h${INACTIVITY_HALF_LIFE_DAYS}-game1-${game1Method}-v3`
  if (mode === 'inactivity') return `elo-k32-1500-h${INACTIVITY_HALF_LIFE_DAYS}-game1-${game1Method}-v3`
  return `elo-k32-1500-raw-game1-${game1Method}-v3`
}

export const runDiscipline = (discipline: Discipline, matches: BacktestMatch[]): DisciplineResult => {
  const ordered = [...matches].sort((left, right) =>
    left.playedOn.localeCompare(right.playedOn) || left.matchId.localeCompare(right.matchId),
  )
  const trainEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.7) - 1)]?.playedOn ?? '1970-01-01'
  const validEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.85) - 1)]?.playedOn ?? trainEnd
  const state = new Map<string, PlayerState>()
  const game1Snapshots: Snapshot[] = []
  const matchSnapshots: Snapshot[] = []
  const pointsSnapshots: PointsSnapshot[] = []
  const counts = emptyCounts()

  const readState = (playerId: string) => {
    const existing = state.get(playerId)
    if (existing) return existing
    const created: PlayerState = {
      elo: INITIAL_ELO,
      matchCount: 0,
      game1Count: 0,
      lastPlayedOn: null,
      game1History: [],
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
    const ratingAEff = effectiveRating(sideA.elo, sideA.matchCount, sideA.lastPlayedOn, match.playedOn, 'full')
    const ratingBEff = effectiveRating(sideB.elo, sideB.matchCount, sideB.lastPlayedOn, match.playedOn, 'full')
    const eloDiffIdle = ratingAIdle - ratingBIdle
    const eloDiffEff = ratingAEff - ratingBEff
    const formDiff = shrunkWinRate(sideA.game1History) - shrunkWinRate(sideB.game1History)
    const pMatchRaw = expectedScore(sideA.elo, sideB.elo)
    const pMatchIdle = expectedScore(ratingAIdle, ratingBIdle)
    const pMatchEff = expectedScore(ratingAEff, ratingBEff)
    const snapshotBase = {
      matchId: match.matchId,
      playedOn: match.playedOn,
      split,
      pMatchRaw,
      pMatchIdle,
      pMatchEff,
      eloDiffRaw,
      eloDiffIdle,
      eloDiffEff,
      formDiff,
    }

    if (match.games.length > 0) {
      pointsSnapshots.push({
        ...snapshotBase,
        games: match.games,
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
    }

    if (match.includeGame1 && match.sideAWonGame1 !== null) {
      counts[split].game1 += 1
      game1Snapshots.push({
        ...snapshotBase,
        y: match.sideAWonGame1 ? 1 : 0,
      })
      sideA.game1History.push(match.sideAWonGame1 ? 1 : 0)
      sideB.game1History.push(match.sideAWonGame1 ? 0 : 1)
      sideA.game1Count += 1
      sideB.game1Count += 1
    }

    sideA.lastPlayedOn = match.playedOn
    sideB.lastPlayedOn = match.playedOn
  }

  const validMatch = matchSnapshots.filter(row => row.split === 'valid')
  const validationMatchRaw = averageLogLoss(validMatch.map(row => toLabeled(row, 'raw')), row => row.pMatch)
  const validationMatchIdle = averageLogLoss(validMatch.map(row => toLabeled(row, 'inactivity')), row => row.pMatch)
  const validationMatchEff = averageLogLoss(validMatch.map(row => toLabeled(row, 'full')), row => row.pMatch)
  const shrinkMode = validationMatchRaw !== null && validationMatchIdle !== null && validationMatchEff !== null
    ? selectShrinkMode(validationMatchRaw, validationMatchIdle, validationMatchEff)
    : 'raw'
  const shrinkEnabled = shrinkMode !== 'raw'

  const train = game1Snapshots.filter(row => row.split === 'train').map(row => toLabeled(row, shrinkMode))
  const valid = game1Snapshots.filter(row => row.split === 'valid').map(row => toLabeled(row, shrinkMode))
  const testGame1 = game1Snapshots.filter(row => row.split === 'test').map(row => toLabeled(row, shrinkMode))
  const testMatch = matchSnapshots.filter(row => row.split === 'test').map(row => toLabeled(row, shrinkMode))
  const coefficients = train.length > 0 ? fitLogistic(train) : [0, 0, 0] as LogisticCoefficients
  const bins = buildBins(train)
  const validationLogistic = averageLogLoss(valid, row => predictLogistic(coefficients, row.eloDiff, row.formDiff))
  const validationBins = averageLogLoss(valid, row => predictBin(bins, row.eloDiff))
  const validationBo3 = averageLogLoss(valid, row => matchProbabilityToGame1(row.pMatch))
  const validationMatch = averageLogLoss(valid, row => row.pMatch)
  const game1Method = validationLogistic !== null && validationBins !== null && validationMatch !== null && validationBo3 !== null
    ? selectGame1Method(validationLogistic, validationBins, validationMatch, validationBo3)
    : 'bo3'
  const modelVersion = buildModelVersion(shrinkMode, game1Method)
  const trainPoints = pointsSnapshots.filter(row => row.split === 'train')
  const rally = fitRallyModel(trainPoints.map(row => ({
    eloDiff: eloDiffFor(row, shrinkMode),
    games: row.games,
  })))
  const pointsTest = evaluatePointsMarkets(
    trainPoints,
    pointsSnapshots.filter(row => row.split === 'test'),
    rally,
    shrinkMode,
  )

  const rawGame1Probability = (row: LabeledRow) => {
    if (game1Method === 'logistic') return predictLogistic(coefficients, row.eloDiff, row.formDiff)
    if (game1Method === 'bins') return predictBin(bins, row.eloDiff)
    return matchProbabilityToGame1(row.pMatch)
  }
  const game1Probability = (row: LabeledRow) => clampGame1ToMatch(rawGame1Probability(row), row.pMatch)

  const predictions: PredictionRow[] = [
    ...matchSnapshots.map(row => ({
      matchId: row.matchId,
      marketType: 'match_winner' as const,
      modelVersion,
      pSideA: pMatchFor(row, shrinkMode),
      featureAsOf: row.playedOn,
      split: row.split,
    })),
    ...game1Snapshots.map(row => ({
      matchId: row.matchId,
      marketType: 'game1_winner' as const,
      modelVersion,
      pSideA: game1Probability(toLabeled(row, shrinkMode)),
      featureAsOf: row.playedOn,
      split: row.split,
    })),
  ]

  return {
    discipline,
    modelVersion,
    game1Method,
    dataThrough: ordered[ordered.length - 1]?.playedOn ?? '',
    predictions,
    ratings: [...state.entries()].map(([playerId, player]) => ({
      discipline,
      playerId,
      elo: player.elo,
      matchCount: player.matchCount,
      game1Count: player.game1Count,
      lastPlayedOn: player.lastPlayedOn,
      game1Recent: player.game1History.slice(-10),
    })),
    payload: {
      coefficients,
      bins,
      trainEnd,
      validEnd,
      counts,
      shrink: {
        enabled: shrinkEnabled,
        mode: shrinkMode,
        samplePrior: SAMPLE_PRIOR,
        halfLifeDays: INACTIVITY_HALF_LIFE_DAYS,
      },
      validation: {
        logistic: validationLogistic,
        bins: validationBins,
        bo3: validationBo3,
        matchElo: validationMatch,
        matchEloRaw: validationMatchRaw,
        matchEloIdle: validationMatchIdle,
        matchEloEff: validationMatchEff,
      },
      test: {
        match: {
          n: testMatch.length,
          logLoss: averageLogLoss(testMatch, row => row.pMatch),
          brier: averageBrier(testMatch, row => row.pMatch),
          baselineLogLoss: averageLogLoss(testMatch, () => 0.5),
          calibration: calibrationBins(testMatch.map(row => ({ p: row.pMatch, y: row.y }))),
        },
        game1: {
          n: testGame1.length,
          logLoss: averageLogLoss(testGame1, game1Probability),
          brier: averageBrier(testGame1, game1Probability),
          matchEloLogLoss: averageLogLoss(testGame1, row => row.pMatch),
          calibration: calibrationBins(testGame1.map(row => ({ p: game1Probability(row), y: row.y }))),
        },
        ...pointsTest,
      },
      rally,
    },
  }
}

export const runBacktest = (matches: BacktestMatch[]) => {
  const disciplines: Discipline[] = ['MS', 'WS']
  return disciplines.map(discipline =>
    runDiscipline(discipline, matches.filter(match => match.discipline === discipline)),
  )
}
