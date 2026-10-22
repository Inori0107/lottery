/**
 * 網球分數模型
 *
 * 規則：
 * - 大多數賽事 3 盤 2 勝；大滿貫男單 5 盤 3 勝
 * - 每盤先到 6 局，需領先 2 局；6:6 搶七（先到 7 分、領先 2）
 *
 * 以每分勝率推導每局、每盤、全場與總局數分布。
 */

import {
  TENNIS_BO3_CORRECT_SCORES,
  TENNIS_BO5_CORRECT_SCORES,
  type TennisCorrectScore,
} from '../../shared/types'
import { sigmoid } from './game1'
import type { Distribution, RallyCoefficients, RallyRow } from './rally'
import { fitRallyLogistic, rallyProbability } from './rally'

export { fitRallyLogistic, rallyProbability }

export type TennisBestOf = 3 | 5

export type TennisMatchDistribution = {
  bestOf: TennisBestOf
  correctScore: Record<TennisCorrectScore, number>
  total: Distribution
  margin: Distribution
  setMargin: Distribution
  set1Total: Distribution
  set1Margin: Distribution
  pSet: number
}

const GAUSS_HERMITE_NODES = [
  { z: -2.856970013872806, weight: 0.011257411327720691 },
  { z: -1.355626179974266, weight: 0.22207592200561266 },
  { z: 0, weight: 0.5333333333333333 },
  { z: 1.355626179974266, weight: 0.22207592200561266 },
  { z: 2.856970013872806, weight: 0.011257411327720691 },
]

const logit = (p: number) => Math.log(p / (1 - p))

const binomial = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1)
  return result
}

export const gameWinProbability = (pointWin: number): number => {
  const p = pointWin
  const q = 1 - p
  const p4 = p ** 4
  const q3 = q ** 3
  const pWinBeforeDeuce = p4 + 4 * p4 * q + 10 * p4 * q * q
  const pDeuce = 20 * (p ** 3) * q3
  const pWinFromDeuce = (p * p) / (p * p + q * q)
  return pWinBeforeDeuce + pDeuce * pWinFromDeuce
}

export const tiebreakWinProbability = (pointWin: number): number => {
  const p = pointWin
  const q = 1 - p
  let prob = 0
  for (let opponent = 0; opponent <= 5; opponent++) {
    prob += binomial(6 + opponent, opponent) * (p ** 7) * (q ** opponent)
  }
  const pSixAll = binomial(12, 6) * (p ** 6) * (q ** 6)
  const pWinFromSixAll = (p * p) / (p * p + q * q)
  return prob + pSixAll * pWinFromSixAll
}

type SetScore = { gamesA: number, gamesB: number, aWon: boolean, probability: number }

export const setScoreOutcomes = (gameWin: number, tiebreakWin: number): SetScore[] => {
  const g = gameWin
  const h = 1 - gameWin
  const scores: SetScore[] = []

  for (let loser = 0; loser <= 4; loser++) {
    const pA = binomial(5 + loser, loser) * (g ** 6) * (h ** loser)
    const pB = binomial(5 + loser, loser) * (h ** 6) * (g ** loser)
    scores.push({ gamesA: 6, gamesB: loser, aWon: true, probability: pA })
    scores.push({ gamesA: loser, gamesB: 6, aWon: false, probability: pB })
  }

  const pFiveAll = binomial(10, 5) * (g ** 5) * (h ** 5)
  scores.push({ gamesA: 7, gamesB: 5, aWon: true, probability: pFiveAll * g * g })
  scores.push({ gamesA: 5, gamesB: 7, aWon: false, probability: pFiveAll * h * h })

  const pSixAll = pFiveAll * 2 * g * h
  scores.push({ gamesA: 7, gamesB: 6, aWon: true, probability: pSixAll * tiebreakWin })
  scores.push({ gamesA: 6, gamesB: 7, aWon: false, probability: pSixAll * (1 - tiebreakWin) })

  const sum = scores.reduce((total, score) => total + score.probability, 0)
  return scores.map(score => ({ ...score, probability: score.probability / sum }))
}

const toDistribution = (entries: Array<{ value: number, probability: number }>): Distribution => {
  if (entries.length === 0) return { offset: 0, values: [] }
  const min = Math.min(...entries.map(entry => entry.value))
  const max = Math.max(...entries.map(entry => entry.value))
  const values = new Array<number>(max - min + 1).fill(0)
  for (const entry of entries) values[entry.value - min]! += entry.probability
  return { offset: min, values }
}

const convolve = (left: Distribution, right: Distribution): Distribution => {
  if (left.values.length === 0 || right.values.length === 0) return { offset: 0, values: [] }
  const values = new Array<number>(left.values.length + right.values.length - 1).fill(0)
  left.values.forEach((leftProbability, leftIndex) => {
    if (leftProbability === 0) return
    right.values.forEach((rightProbability, rightIndex) => {
      values[leftIndex + rightIndex]! += leftProbability * rightProbability
    })
  })
  return { offset: left.offset + right.offset, values }
}

const scale = (distribution: Distribution, factor: number): Distribution => ({
  offset: distribution.offset,
  values: distribution.values.map(value => value * factor),
})

const combine = (distributions: Distribution[]): Distribution => {
  const filled = distributions.filter(distribution => distribution.values.length > 0)
  if (filled.length === 0) return { offset: 0, values: [] }
  const min = Math.min(...filled.map(distribution => distribution.offset))
  const max = Math.max(...filled.map(distribution => distribution.offset + distribution.values.length - 1))
  const values = new Array<number>(max - min + 1).fill(0)
  for (const distribution of filled) {
    distribution.values.forEach((probability, index) => {
      values[distribution.offset + index - min]! += probability
    })
  }
  return { offset: min, values }
}

const normalizeDistribution = (distribution: Distribution): Distribution => {
  const sum = distribution.values.reduce((total, value) => total + value, 0)
  if (sum === 0 || Math.abs(sum - 1) < 1e-12) return distribution
  return { offset: distribution.offset, values: distribution.values.map(value => value / sum) }
}

const emptyCorrectScore = (bestOf: TennisBestOf): Record<TennisCorrectScore, number> => {
  const keys = bestOf === 5 ? TENNIS_BO5_CORRECT_SCORES : TENNIS_BO3_CORRECT_SCORES
  return Object.fromEntries(keys.map(score => [score, 0])) as Record<TennisCorrectScore, number>
}

const independentTennisMatchDistribution = (
  pointWin: number,
  bestOf: TennisBestOf,
): TennisMatchDistribution => {
  const gameWin = gameWinProbability(pointWin)
  const tiebreakWin = tiebreakWinProbability(pointWin)
  const outcomes = setScoreOutcomes(gameWin, tiebreakWin)
  const pSet = outcomes.filter(outcome => outcome.aWon).reduce((sum, outcome) => sum + outcome.probability, 0)
  const qSet = 1 - pSet

  const setTotalA = normalizeDistribution(toDistribution(
    outcomes.filter(outcome => outcome.aWon).map(outcome => ({
      value: outcome.gamesA + outcome.gamesB,
      probability: outcome.probability,
    })),
  ))
  const setTotalB = normalizeDistribution(toDistribution(
    outcomes.filter(outcome => !outcome.aWon).map(outcome => ({
      value: outcome.gamesA + outcome.gamesB,
      probability: outcome.probability,
    })),
  ))
  const setMarginA = normalizeDistribution(toDistribution(
    outcomes.filter(outcome => outcome.aWon).map(outcome => ({
      value: outcome.gamesA - outcome.gamesB,
      probability: outcome.probability,
    })),
  ))
  const setMarginB = normalizeDistribution(toDistribution(
    outcomes.filter(outcome => !outcome.aWon).map(outcome => ({
      value: outcome.gamesA - outcome.gamesB,
      probability: outcome.probability,
    })),
  ))

  const correctScore = emptyCorrectScore(bestOf)
  const totals: Distribution[] = []
  const margins: Distribution[] = []
  const setMargins: Array<{ value: number, probability: number }> = []

  const pushOutcome = (
    score: TennisCorrectScore,
    probability: number,
    total: Distribution,
    margin: Distribution,
    setDiff: number,
  ) => {
    correctScore[score] = probability
    totals.push(scale(total, probability))
    margins.push(scale(margin, probability))
    setMargins.push({ value: setDiff, probability })
  }

  if (bestOf === 3) {
    const twoA = convolve(setTotalA, setTotalA)
    const twoB = convolve(setTotalB, setTotalB)
    const twoA_oneB = convolve(twoA, setTotalB)
    const oneA_twoB = convolve(twoB, setTotalA)
    const twoAMargin = convolve(setMarginA, setMarginA)
    const twoBMargin = convolve(setMarginB, setMarginB)

    pushOutcome('2:0', pSet ** 2, twoA, twoAMargin, 2)
    pushOutcome('2:1', 2 * (pSet ** 2) * qSet, twoA_oneB, convolve(twoAMargin, setMarginB), 1)
    pushOutcome('1:2', 2 * pSet * (qSet ** 2), oneA_twoB, convolve(twoBMargin, setMarginA), -1)
    pushOutcome('0:2', qSet ** 2, twoB, twoBMargin, -2)
  } else {
    const threeA = convolve(convolve(setTotalA, setTotalA), setTotalA)
    const threeB = convolve(convolve(setTotalB, setTotalB), setTotalB)
    const threeAMargin = convolve(convolve(setMarginA, setMarginA), setMarginA)
    const threeBMargin = convolve(convolve(setMarginB, setMarginB), setMarginB)
    const twoA_oneB = convolve(convolve(setTotalA, setTotalA), setTotalB)
    const twoB_oneA = convolve(convolve(setTotalB, setTotalB), setTotalA)
    const twoA_twoB = convolve(twoA_oneB, setTotalB)

    pushOutcome('3:0', pSet ** 3, threeA, threeAMargin, 3)
    pushOutcome('3:1', 3 * (pSet ** 3) * qSet, convolve(twoA_oneB, setTotalA), convolve(convolve(setMarginA, setMarginA), convolve(setMarginB, setMarginA)), 2)
    pushOutcome('3:2', 6 * (pSet ** 3) * (qSet ** 2), convolve(twoA_twoB, setTotalA), convolve(convolve(convolve(setMarginA, setMarginA), convolve(setMarginB, setMarginB)), setMarginA), 1)
    pushOutcome('2:3', 6 * (pSet ** 2) * (qSet ** 3), convolve(twoA_twoB, setTotalB), convolve(convolve(convolve(setMarginA, setMarginA), convolve(setMarginB, setMarginB)), setMarginB), -1)
    pushOutcome('1:3', 3 * pSet * (qSet ** 3), convolve(twoB_oneA, setTotalB), convolve(convolve(setMarginB, setMarginB), convolve(setMarginA, setMarginB)), -2)
    pushOutcome('0:3', qSet ** 3, threeB, threeBMargin, -3)
  }

  const totalSum = Object.values(correctScore).reduce((sum, value) => sum + value, 0)
  for (const score of Object.keys(correctScore) as TennisCorrectScore[]) {
    correctScore[score] = correctScore[score]! / totalSum
  }

  return {
    bestOf,
    correctScore,
    total: combine(totals),
    margin: combine(margins),
    setMargin: toDistribution(setMargins),
    set1Total: combine([scale(setTotalA, pSet), scale(setTotalB, qSet)]),
    set1Margin: combine([scale(setMarginA, pSet), scale(setMarginB, qSet)]),
    pSet,
  }
}

export const tennisMatchDistribution = (
  pointWin: number,
  sigma = 0,
  bestOf: TennisBestOf = 3,
): TennisMatchDistribution => {
  const clipped = Math.min(0.85, Math.max(0.15, pointWin))
  if (sigma === 0) return independentTennisMatchDistribution(clipped, bestOf)

  const center = logit(clipped)
  const parts = GAUSS_HERMITE_NODES.map(node => ({
    weight: node.weight,
    distribution: independentTennisMatchDistribution(sigmoid(center + sigma * node.z), bestOf),
  }))

  const keys = bestOf === 5 ? TENNIS_BO5_CORRECT_SCORES : TENNIS_BO3_CORRECT_SCORES
  const correctScore = Object.fromEntries(keys.map(score => [
    score,
    parts.reduce((sum, part) => sum + part.weight * part.distribution.correctScore[score], 0),
  ])) as Record<TennisCorrectScore, number>

  return {
    bestOf,
    correctScore,
    total: combine(parts.map(part => scale(part.distribution.total, part.weight))),
    margin: combine(parts.map(part => scale(part.distribution.margin, part.weight))),
    setMargin: combine(parts.map(part => scale(part.distribution.setMargin, part.weight))),
    set1Total: combine(parts.map(part => scale(part.distribution.set1Total, part.weight))),
    set1Margin: combine(parts.map(part => scale(part.distribution.set1Margin, part.weight))),
    pSet: parts.reduce((sum, part) => sum + part.weight * part.distribution.pSet, 0),
  }
}

export type TennisRallyModel = {
  coefficients: RallyCoefficients
  sigma: number
}

export type TennisRallyMatchRow = {
  eloDiff: number
  sets: Array<{ gamesA: number, gamesB: number }>
}

export const fitTennisRallyModel = (matches: TennisRallyMatchRow[]): TennisRallyModel => {
  const rows: RallyRow[] = matches.flatMap(match =>
    match.sets.map(set => ({
      eloDiff: match.eloDiff,
      pointsA: set.gamesA,
      pointsB: set.gamesB,
    })),
  )
  return {
    coefficients: rows.length > 0 ? fitRallyLogistic(rows) : [0, 0.002],
    sigma: 0.08,
  }
}

export const gameWinToPointWin = (gameWin: number) => {
  const target = Math.min(0.999, Math.max(0.001, gameWin))
  let low = 0.05
  let high = 0.95
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (gameWinProbability(mid) > target) high = mid
    else low = mid
  }
  return (low + high) / 2
}

export const matchWinProbability = (pointWin: number, bestOf: TennisBestOf = 3) => {
  const pSet = setScoreOutcomes(gameWinProbability(pointWin), tiebreakWinProbability(pointWin))
    .filter(outcome => outcome.aWon)
    .reduce((sum, outcome) => sum + outcome.probability, 0)
  return bestOf === 5
    ? (pSet ** 3) * (1 + 3 * (1 - pSet) + 6 * ((1 - pSet) ** 2))
    : (pSet ** 2) * (1 + 2 * (1 - pSet))
}

export const tennisRallyMatchDistribution = (
  model: TennisRallyModel,
  eloDiff: number,
  bestOf: TennisBestOf = 3,
) => {
  const gameWin = rallyProbability(model.coefficients, eloDiff)
  return tennisMatchDistribution(gameWinToPointWin(gameWin), model.sigma, bestOf)
}

export const matchProbabilityToSet1 = (pMatch: number, bestOf: TennisBestOf = 3) => {
  const target = Math.min(0.999, Math.max(0.001, pMatch))
  let low = 0.001
  let high = 0.999
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    const predicted = bestOf === 5
      ? (mid ** 3) * (1 + 3 * (1 - mid) + 6 * ((1 - mid) ** 2))
      : (mid ** 2) * (1 + 2 * (1 - mid))
    if (predicted > target) high = mid
    else low = mid
  }
  return (low + high) / 2
}

export const matchProbabilityToPoint = (pMatch: number, bestOf: TennisBestOf = 3) => {
  const target = Math.min(0.999, Math.max(0.001, pMatch))
  let low = 0.05
  let high = 0.95
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (matchWinProbability(mid, bestOf) > target) high = mid
    else low = mid
  }
  return (low + high) / 2
}

export const probabilityAbove = (distribution: Distribution, line: number) =>
  distribution.values.reduce((sum, probability, index) => (
    distribution.offset + index > line ? sum + probability : sum
  ), 0)

export const distributionMean = (distribution: Distribution) =>
  distribution.values.reduce((sum, probability, index) => sum + probability * (distribution.offset + index), 0)

export const coversHandicap = (margin: Distribution, handicap: number) =>
  probabilityAbove(margin, -handicap)

export const fairLine = (distribution: Distribution) => {
  const halfLines = distribution.values.map((_, index) => distribution.offset + index + 0.5)
  let best = halfLines[0] ?? 0.5
  let bestGap = Number.POSITIVE_INFINITY
  for (const line of halfLines) {
    const gap = Math.abs(probabilityAbove(distribution, line) - 0.5)
    if (gap < bestGap) {
      best = line
      bestGap = gap
    }
  }
  return best
}
