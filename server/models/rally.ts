import { CORRECT_SCORES, type CorrectScore } from '../../shared/types'
import {
  GAUSS_HERMITE_NODES,
  combine,
  convolve,
  coversHandicap,
  distributionMean,
  fairLine,
  linesWithin,
  logit,
  probabilityAbove,
  scale,
  toDistribution,
  totalMass,
  type Distribution,
} from './dist'
import { sigmoid } from './game1'

export { CORRECT_SCORES, coversHandicap, distributionMean, fairLine, linesWithin, probabilityAbove, type CorrectScore, type Distribution }

export type RallyCoefficients = [number, number]

export type RallyRow = {
  eloDiff: number
  pointsA: number
  pointsB: number
}

export type MatchDistribution = {
  correctScore: Record<CorrectScore, number>
  total: Distribution
  margin: Distribution
}

const GAME_POINTS = 21
const POINT_CAP = 30

const isGameOver = (pointsA: number, pointsB: number) => {
  const high = Math.max(pointsA, pointsB)
  const low = Math.min(pointsA, pointsB)
  return high === POINT_CAP || (high >= GAME_POINTS && high - low >= 2)
}

export const fitRallyLogistic = (rows: RallyRow[]): RallyCoefficients => {
  let coefficients: RallyCoefficients = [0, 0]
  const ridge = 1e-3

  for (let iteration = 0; iteration < 30; iteration += 1) {
    let h00 = ridge
    let h01 = 0
    let h11 = ridge
    let g0 = 0
    let g1 = 0

    for (const row of rows) {
      const rallies = row.pointsA + row.pointsB
      if (rallies === 0) continue
      const probability = sigmoid(coefficients[0] + coefficients[1] * row.eloDiff)
      const residual = row.pointsA - rallies * probability
      const weight = rallies * probability * (1 - probability)
      g0 += residual
      g1 += residual * row.eloDiff
      h00 += weight
      h01 += weight * row.eloDiff
      h11 += weight * row.eloDiff * row.eloDiff
    }

    const determinant = h00 * h11 - h01 * h01
    if (Math.abs(determinant) < 1e-12) break
    const step0 = (h11 * g0 - h01 * g1) / determinant
    const step1 = (h00 * g1 - h01 * g0) / determinant
    coefficients = [coefficients[0] + step0, coefficients[1] + step1]
    if (Math.hypot(step0, step1) < 1e-10) break
  }

  return coefficients
}

export const rallyProbability = (coefficients: RallyCoefficients, eloDiff: number) =>
  sigmoid(coefficients[0] + coefficients[1] * eloDiff)

type GameScore = { pointsA: number, pointsB: number, probability: number }

const iidGameScores = (rallyWin: number) => {
  const reach = Array.from({ length: POINT_CAP + 1 }, () => new Array<number>(POINT_CAP + 1).fill(0))
  const scores: GameScore[] = []
  reach[0]![0] = 1

  for (let sum = 0; sum <= POINT_CAP * 2 - 1; sum += 1) {
    for (let pointsA = Math.max(0, sum - POINT_CAP); pointsA <= Math.min(POINT_CAP, sum); pointsA += 1) {
      const pointsB = sum - pointsA
      const probability = reach[pointsA]![pointsB]!
      if (probability === 0) continue
      if (isGameOver(pointsA, pointsB)) {
        scores.push({ pointsA, pointsB, probability })
        continue
      }
      reach[pointsA + 1]![pointsB]! += probability * rallyWin
      reach[pointsA]![pointsB + 1]! += probability * (1 - rallyWin)
    }
  }

  return scores
}

export const gameScoreDistribution = (rallyWin: number, sigma = 0): GameScore[] => {
  if (sigma === 0) return iidGameScores(rallyWin)
  const center = logit(rallyWin)
  const merged = new Map<number, GameScore>()
  for (const node of GAUSS_HERMITE_NODES) {
    for (const score of iidGameScores(sigmoid(center + sigma * node.z))) {
      const key = score.pointsA * (POINT_CAP + 1) + score.pointsB
      const existing = merged.get(key)
      if (existing) existing.probability += node.weight * score.probability
      else merged.set(key, { ...score, probability: node.weight * score.probability })
    }
  }
  return [...merged.values()]
}

const SLOPE_SCALES = Array.from({ length: 17 }, (_, index) => 0.8 + index * 0.1)
const NOISE_LEVELS = Array.from({ length: 21 }, (_, index) => index * 0.05)
const COORDINATE_PASSES = 3
const LOGIT_GRID_MIN = -4
const LOGIT_GRID_STEP = 0.02
const LOGIT_GRID_SIZE = 401

const buildScoreTable = () => {
  const scoreIndex = new Map<number, number>()
  iidGameScores(0.5).forEach((score, index) => {
    scoreIndex.set(score.pointsA * (POINT_CAP + 1) + score.pointsB, index)
  })
  const table = new Float64Array(LOGIT_GRID_SIZE * scoreIndex.size)
  for (let grid = 0; grid < LOGIT_GRID_SIZE; grid += 1) {
    for (const score of iidGameScores(sigmoid(LOGIT_GRID_MIN + grid * LOGIT_GRID_STEP))) {
      const index = scoreIndex.get(score.pointsA * (POINT_CAP + 1) + score.pointsB)
      if (index !== undefined) table[grid * scoreIndex.size + index] = score.probability
    }
  }
  const likelihood = (logitValue: number, index: number) => {
    const grid = Math.round((logitValue - LOGIT_GRID_MIN) / LOGIT_GRID_STEP)
    const clamped = Math.min(LOGIT_GRID_SIZE - 1, Math.max(0, grid))
    return table[clamped * scoreIndex.size + index] ?? 0
  }
  return { scoreIndex, likelihood }
}

export type RallyModel = {
  coefficients: RallyCoefficients
  sigma: number
  tau?: number
}

export type RallyMatchRow = {
  eloDiff: number
  games: Array<{ pointsA: number, pointsB: number }>
}

type FitParameters = { slopeScale: number, sigma: number, tau: number }

export const fitRallyModel = (matches: RallyMatchRow[]): RallyModel => {
  const base = fitRallyLogistic(matches.flatMap(match => match.games.map(game => ({ eloDiff: match.eloDiff, ...game }))))
  const { scoreIndex, likelihood } = buildScoreTable()
  const indexed = matches.flatMap((match) => {
    const indexes = match.games.map(game => scoreIndex.get(game.pointsA * (POINT_CAP + 1) + game.pointsB))
    if (indexes.length === 0 || indexes.some(index => index === undefined)) return []
    return [{ eloDiff: match.eloDiff, indexes: indexes as number[] }]
  })

  const gameLikelihood = (center: number, sigma: number, index: number) =>
    GAUSS_HERMITE_NODES.reduce((sum, node) => sum + node.weight * likelihood(center + sigma * node.z, index), 0)

  const logLikelihoodOf = ({ slopeScale, sigma, tau }: FitParameters) => {
    let total = 0
    for (const match of indexed) {
      const center = base[0] + base[1] * slopeScale * match.eloDiff
      const probability = GAUSS_HERMITE_NODES.reduce((sum, node) => {
        const shifted = center + tau * node.z
        const product = match.indexes.reduce((value, index) => value * gameLikelihood(shifted, sigma, index), 1)
        return sum + node.weight * product
      }, 0)
      total += Math.log(Math.max(1e-300, probability))
    }
    return total
  }

  let best: FitParameters = { slopeScale: 1, sigma: 0, tau: 0 }
  let bestLogLikelihood = logLikelihoodOf(best)
  const searchAxis = (key: keyof FitParameters, grid: number[]) => {
    for (const value of grid) {
      const candidate = { ...best, [key]: value }
      const logLikelihood = logLikelihoodOf(candidate)
      if (logLikelihood > bestLogLikelihood) {
        bestLogLikelihood = logLikelihood
        best = candidate
      }
    }
  }

  for (let pass = 0; pass < COORDINATE_PASSES; pass += 1) {
    searchAxis('tau', NOISE_LEVELS)
    searchAxis('sigma', NOISE_LEVELS)
    searchAxis('slopeScale', SLOPE_SCALES)
  }

  return {
    coefficients: [base[0], base[1] * best.slopeScale],
    sigma: best.sigma,
    tau: best.tau,
  }
}

const matchPaths = (wonA: Distribution, wonB: Distribution) => {
  const twoA = convolve(wonA, wonA)
  const twoB = convolve(wonB, wonB)
  return combine([
    twoA,
    twoB,
    scale(convolve(twoA, wonB), 2),
    scale(convolve(twoB, wonA), 2),
  ])
}

const independentGamesDistribution = (rallyWin: number, sigma: number): MatchDistribution => {
  const scores = gameScoreDistribution(rallyWin, sigma)
  const winsA = scores.filter(score => score.pointsA > score.pointsB)
  const winsB = scores.filter(score => score.pointsB > score.pointsA)
  const totalOf = (list: typeof scores) =>
    toDistribution(list.map(score => ({ value: score.pointsA + score.pointsB, probability: score.probability })))
  const marginOf = (list: typeof scores) =>
    toDistribution(list.map(score => ({ value: score.pointsA - score.pointsB, probability: score.probability })))
  const totalA = totalOf(winsA)
  const totalB = totalOf(winsB)
  const gameA = totalMass(totalA)
  const gameB = totalMass(totalB)

  return {
    correctScore: {
      '2:0': gameA * gameA,
      '2:1': 2 * gameA * gameA * gameB,
      '1:2': 2 * gameA * gameB * gameB,
      '0:2': gameB * gameB,
    },
    total: matchPaths(totalA, totalB),
    margin: matchPaths(marginOf(winsA), marginOf(winsB)),
  }
}

export const matchDistribution = (rallyWin: number, sigma = 0, tau = 0): MatchDistribution => {
  if (tau === 0) return independentGamesDistribution(rallyWin, sigma)
  const center = logit(rallyWin)
  const parts = GAUSS_HERMITE_NODES.map(node => ({
    weight: node.weight,
    distribution: independentGamesDistribution(sigmoid(center + tau * node.z), sigma),
  }))
  const correctScore = Object.fromEntries(CORRECT_SCORES.map(score => [
    score,
    parts.reduce((sum, part) => sum + part.weight * part.distribution.correctScore[score], 0),
  ])) as Record<CorrectScore, number>
  return {
    correctScore,
    total: combine(parts.map(part => scale(part.distribution.total, part.weight))),
    margin: combine(parts.map(part => scale(part.distribution.margin, part.weight))),
  }
}

export const rallyMatchDistribution = (model: RallyModel, eloDiff: number) =>
  matchDistribution(rallyProbability(model.coefficients, eloDiff), model.sigma, model.tau ?? 0)

export const gamePointDistributions = (rallyWin: number, sigma = 0, tau = 0): Pick<MatchDistribution, 'total' | 'margin'> => {
  if (tau !== 0) {
    const parts = GAUSS_HERMITE_NODES.map(node => ({
      weight: node.weight,
      distribution: gamePointDistributions(sigmoid(logit(rallyWin) + tau * node.z), sigma),
    }))
    return {
      total: combine(parts.map(part => scale(part.distribution.total, part.weight))),
      margin: combine(parts.map(part => scale(part.distribution.margin, part.weight))),
    }
  }
  const scores = gameScoreDistribution(rallyWin, sigma)
  return {
    total: toDistribution(scores.map(score => ({
      value: score.pointsA + score.pointsB,
      probability: score.probability,
    }))),
    margin: toDistribution(scores.map(score => ({
      value: score.pointsA - score.pointsB,
      probability: score.probability,
    }))),
  }
}

export const setCountFromCorrectScore = (correctScore: Record<CorrectScore, number>) => ({
  '2': correctScore['2:0'] + correctScore['0:2'],
  '3': correctScore['2:1'] + correctScore['1:2'],
})
