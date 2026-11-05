/**
 * 排球每球得分模型
 * 
 * 排球規則：
 * - 5 局 3 勝制
 * - 前 4 局每局 25 分，需領先 2 分才能獲勝，無上限
 * - 第 5 局（決勝局）15 分，需領先 2 分才能獲勝，無上限
 * 
 * 與羽球的差異：
 * - 羽球 3 局 2 勝，每局 21 分，30 分封頂
 * - 排球有 6 種正確比數（3:0, 3:1, 3:2, 2:3, 1:3, 0:3）
 */

import { VOLLEYBALL_CORRECT_SCORES, type VolleyballCorrectScore } from '../../shared/types'
import {
  GAUSS_HERMITE_NODES,
  combine,
  convolve,
  coversHandicap,
  distributionMean,
  fairLine,
  logit,
  normalizeDistribution,
  probabilityAbove,
  scale,
  toDistribution,
  type Distribution,
} from './dist'
import { sigmoid } from './game1'
import type { RallyCoefficients, RallyRow } from './rally'
import { fitRallyLogistic, rallyProbability } from './rally'

export { coversHandicap, distributionMean, fairLine, fitRallyLogistic, probabilityAbove, rallyProbability }

export type VolleyballMatchDistribution = {
  correctScore: Record<VolleyballCorrectScore, number>
  total: Distribution
  margin: Distribution
  setMargin: Distribution
  set1Total: Distribution
  set1Margin: Distribution
}

const NORMAL_SET_POINTS = 25
const DECIDING_SET_POINTS = 15
const DEUCE_ADVANTAGE = 2
const MAX_DEUCE_POINTS = 50

const isSetOver = (pointsA: number, pointsB: number, isDecidingSet: boolean) => {
  const targetPoints = isDecidingSet ? DECIDING_SET_POINTS : NORMAL_SET_POINTS
  const high = Math.max(pointsA, pointsB)
  const low = Math.min(pointsA, pointsB)
  if (high < targetPoints) return false
  return high - low >= DEUCE_ADVANTAGE
}

type SetScore = { pointsA: number, pointsB: number, probability: number }

const iidSetScores = (rallyWin: number, isDecidingSet: boolean): SetScore[] => {
  const targetPoints = isDecidingSet ? DECIDING_SET_POINTS : NORMAL_SET_POINTS
  const maxPoints = targetPoints + MAX_DEUCE_POINTS
  const reach = Array.from({ length: maxPoints + 1 }, () => new Array<number>(maxPoints + 1).fill(0))
  const scores: SetScore[] = []
  reach[0]![0] = 1

  for (let sum = 0; sum <= maxPoints * 2 - 1; sum += 1) {
    for (let pointsA = Math.max(0, sum - maxPoints); pointsA <= Math.min(maxPoints, sum); pointsA += 1) {
      const pointsB = sum - pointsA
      const probability = reach[pointsA]![pointsB]!
      if (probability === 0 || probability < 1e-12) continue
      if (isSetOver(pointsA, pointsB, isDecidingSet)) {
        scores.push({ pointsA, pointsB, probability })
        continue
      }
      if (pointsA < maxPoints) {
        reach[pointsA + 1]![pointsB]! += probability * rallyWin
      }
      if (pointsB < maxPoints) {
        reach[pointsA]![pointsB + 1]! += probability * (1 - rallyWin)
      }
    }
  }

  return scores
}

export const setScoreDistribution = (rallyWin: number, sigma = 0, isDecidingSet = false): SetScore[] => {
  if (sigma === 0) return iidSetScores(rallyWin, isDecidingSet)
  const center = logit(rallyWin)
  const merged = new Map<string, SetScore>()
  for (const node of GAUSS_HERMITE_NODES) {
    for (const score of iidSetScores(sigmoid(center + sigma * node.z), isDecidingSet)) {
      const key = `${score.pointsA}:${score.pointsB}`
      const existing = merged.get(key)
      if (existing) existing.probability += node.weight * score.probability
      else merged.set(key, { ...score, probability: node.weight * score.probability })
    }
  }
  return [...merged.values()]
}

type SetWinDistributions = {
  pSetA: number
  pSetB: number
  totalA: Distribution
  totalB: Distribution
  marginA: Distribution
  marginB: Distribution
}

const computeSetDistributions = (scores: SetScore[]): SetWinDistributions => {
  const winsA = scores.filter(score => score.pointsA > score.pointsB)
  const winsB = scores.filter(score => score.pointsB > score.pointsA)

  const pSetA = winsA.reduce((sum, s) => sum + s.probability, 0)
  const pSetB = winsB.reduce((sum, s) => sum + s.probability, 0)

  const totalOf = (list: SetScore[]) =>
    toDistribution(list.map(score => ({ value: score.pointsA + score.pointsB, probability: score.probability })))
  const marginOf = (list: SetScore[]) =>
    toDistribution(list.map(score => ({ value: score.pointsA - score.pointsB, probability: score.probability })))

  return {
    pSetA,
    pSetB,
    totalA: normalizeDistribution(totalOf(winsA)),
    totalB: normalizeDistribution(totalOf(winsB)),
    marginA: normalizeDistribution(marginOf(winsA)),
    marginB: normalizeDistribution(marginOf(winsB)),
  }
}

const independentVolleyballMatchDistribution = (
  rallyWin: number,
  sigma: number,
): VolleyballMatchDistribution => {
  const normalSetScores = setScoreDistribution(rallyWin, sigma, false)
  const decidingSetScores = setScoreDistribution(rallyWin, sigma, true)

  const normal = computeSetDistributions(normalSetScores)
  const deciding = computeSetDistributions(decidingSetScores)

  const pSetA = normal.pSetA
  const pSetB = normal.pSetB
  const pDecidingA = deciding.pSetA
  const pDecidingB = deciding.pSetB

  const p3_0 = pSetA ** 3
  const p3_1 = 3 * (pSetA ** 3) * pSetB
  const p3_2 = 6 * (pSetA ** 2) * (pSetB ** 2) * pDecidingA
  const p2_3 = 6 * (pSetA ** 2) * (pSetB ** 2) * pDecidingB
  const p1_3 = 3 * pSetA * (pSetB ** 3)
  const p0_3 = pSetB ** 3

  const totalSum = p3_0 + p3_1 + p3_2 + p2_3 + p1_3 + p0_3
  const correctScore: Record<VolleyballCorrectScore, number> = {
    '3:0': p3_0 / totalSum,
    '3:1': p3_1 / totalSum,
    '3:2': p3_2 / totalSum,
    '2:3': p2_3 / totalSum,
    '1:3': p1_3 / totalSum,
    '0:3': p0_3 / totalSum,
  }

  const buildMatchTotal = (): Distribution => {
    const distributions: Distribution[] = []

    const threeA = convolve(convolve(normal.totalA, normal.totalA), normal.totalA)
    const threeB = convolve(convolve(normal.totalB, normal.totalB), normal.totalB)

    distributions.push(scale(threeA, p3_0))
    distributions.push(scale(threeB, p0_3))

    const twoA_oneB = convolve(convolve(normal.totalA, normal.totalA), normal.totalB)
    const oneA_twoB = convolve(convolve(normal.totalB, normal.totalB), normal.totalA)
    distributions.push(scale(convolve(twoA_oneB, normal.totalA), p3_1))
    distributions.push(scale(convolve(oneA_twoB, normal.totalB), p1_3))

    const twoA_twoB = convolve(convolve(normal.totalA, normal.totalA), convolve(normal.totalB, normal.totalB))
    distributions.push(scale(convolve(twoA_twoB, deciding.totalA), p3_2))
    distributions.push(scale(convolve(twoA_twoB, deciding.totalB), p2_3))

    return combine(distributions)
  }

  const buildMatchMargin = (): Distribution => {
    const distributions: Distribution[] = []

    const threeA = convolve(convolve(normal.marginA, normal.marginA), normal.marginA)
    const threeB = convolve(convolve(normal.marginB, normal.marginB), normal.marginB)

    distributions.push(scale(threeA, p3_0))
    distributions.push(scale(threeB, p0_3))

    const twoA_oneB = convolve(convolve(normal.marginA, normal.marginA), normal.marginB)
    const oneA_twoB = convolve(convolve(normal.marginB, normal.marginB), normal.marginA)
    distributions.push(scale(convolve(twoA_oneB, normal.marginA), p3_1))
    distributions.push(scale(convolve(oneA_twoB, normal.marginB), p1_3))

    const twoA_twoB = convolve(convolve(normal.marginA, normal.marginA), convolve(normal.marginB, normal.marginB))
    distributions.push(scale(convolve(twoA_twoB, deciding.marginA), p3_2))
    distributions.push(scale(convolve(twoA_twoB, deciding.marginB), p2_3))

    return combine(distributions)
  }

  const set1Total = combine([scale(normal.totalA, pSetA), scale(normal.totalB, pSetB)])
  const set1Margin = combine([scale(normal.marginA, pSetA), scale(normal.marginB, pSetB)])

  return {
    correctScore,
    total: buildMatchTotal(),
    margin: buildMatchMargin(),
    setMargin: setMarginFromCorrectScore(correctScore),
    set1Total,
    set1Margin,
  }
}

export const setMarginFromCorrectScore = (correctScore: Record<VolleyballCorrectScore, number>): Distribution =>
  toDistribution([
    { value: 3, probability: correctScore['3:0'] },
    { value: 2, probability: correctScore['3:1'] },
    { value: 1, probability: correctScore['3:2'] },
    { value: -1, probability: correctScore['2:3'] },
    { value: -2, probability: correctScore['1:3'] },
    { value: -3, probability: correctScore['0:3'] },
  ])

export const matchWinProbability = (rallyWin: number, sigma = 0) => {
  const { correctScore } = volleyballMatchDistribution(rallyWin, sigma)
  return correctScore['3:0'] + correctScore['3:1'] + correctScore['3:2']
}

export const matchProbabilityToPoint = (pMatch: number, sigma = 0) => {
  const target = Math.min(0.999, Math.max(0.001, pMatch))
  let low = 0.01
  let high = 0.99
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2
    if (matchWinProbability(mid, sigma) < target) low = mid
    else high = mid
  }
  return (low + high) / 2
}

export const matchProbabilityToSet1 = (pMatch: number, sigma = 0) => {
  const scores = setScoreDistribution(matchProbabilityToPoint(pMatch, sigma), sigma, false)
  return scores.filter(score => score.pointsA > score.pointsB).reduce((sum, score) => sum + score.probability, 0)
}

export const volleyballSetCount = (correctScore: Record<VolleyballCorrectScore, number>) => ({
  '3': correctScore['3:0'] + correctScore['0:3'],
  '4': correctScore['3:1'] + correctScore['1:3'],
  '5': correctScore['3:2'] + correctScore['2:3'],
})

export const volleyballMatchDistribution = (
  rallyWin: number,
  sigma = 0,
  tau = 0,
): VolleyballMatchDistribution => {
  if (tau === 0) return independentVolleyballMatchDistribution(rallyWin, sigma)

  const center = logit(rallyWin)
  const parts = GAUSS_HERMITE_NODES.map(node => ({
    weight: node.weight,
    distribution: independentVolleyballMatchDistribution(sigmoid(center + tau * node.z), sigma),
  }))

  const correctScore = Object.fromEntries(VOLLEYBALL_CORRECT_SCORES.map(score => [
    score,
    parts.reduce((sum, part) => sum + part.weight * part.distribution.correctScore[score], 0),
  ])) as Record<VolleyballCorrectScore, number>

  return {
    correctScore,
    total: combine(parts.map(part => scale(part.distribution.total, part.weight))),
    margin: combine(parts.map(part => scale(part.distribution.margin, part.weight))),
    setMargin: setMarginFromCorrectScore(correctScore),
    set1Total: combine(parts.map(part => scale(part.distribution.set1Total, part.weight))),
    set1Margin: combine(parts.map(part => scale(part.distribution.set1Margin, part.weight))),
  }
}

export type VolleyballRallyModel = {
  coefficients: RallyCoefficients
  sigma: number
  tau?: number
  homeAdvantage: number
  rosterStrengthWeight: number
}

export type VolleyballRallyMatchRow = {
  eloDiff: number
  homeFactor: number
  rosterDiff: number
  sets: Array<{ pointsA: number, pointsB: number }>
}

export const fitVolleyballRallyModel = (matches: VolleyballRallyMatchRow[]): VolleyballRallyModel => {
  const rows: RallyRow[] = matches.flatMap(match =>
    match.sets.map(set => ({ eloDiff: match.eloDiff, ...set }))
  )
  const baseCoefficients = fitRallyLogistic(rows)

  return {
    coefficients: baseCoefficients,
    sigma: 0.1,
    tau: 0.05,
    homeAdvantage: 0.02,
    rosterStrengthWeight: 0.5,
  }
}

export const volleyballRallyMatchDistribution = (
  model: VolleyballRallyModel,
  eloDiff: number,
  isHome: boolean,
  rosterDiff: number,
) => {
  const homeBonus = isHome ? model.homeAdvantage : 0
  const rosterBonus = rosterDiff * model.rosterStrengthWeight
  const adjustedEloDiff = eloDiff + (homeBonus + rosterBonus) * 400

  const baseRallyWin = rallyProbability(model.coefficients, adjustedEloDiff)

  return volleyballMatchDistribution(baseRallyWin, model.sigma, model.tau ?? 0)
}
