import {
  TENNIS_BO3_CORRECT_SCORES,
  TENNIS_BO5_CORRECT_SCORES,
  type TennisBestOf,
  type TennisCorrectScore,
} from '../../shared/sports'
import {
  combine,
  convolve,
  coversHandicap,
  distributionMean,
  fairLine,
  normalizeDistribution,
  probabilityAbove,
  scale,
  toDistribution,
  type Distribution,
} from './dist'
import { sigmoid } from './game1'
import { fitRallyLogistic, rallyProbability, type RallyCoefficients, type RallyRow } from './rally'

export { coversHandicap, distributionMean, fairLine, fitRallyLogistic, probabilityAbove, rallyProbability }
export type { RallyCoefficients, RallyRow }

export type TennisSetScore = {
  gamesA: number
  gamesB: number
  probability: number
}

export type TennisMatchDistribution = {
  correctScore: Partial<Record<TennisCorrectScore, number>>
  total: Distribution
  margin: Distribution
  setMargin: Distribution
  set1Total: Distribution
  set1Margin: Distribution
}

export const gameWinProbability = (pointWin: number) => {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, pointWin))
  const q = 1 - p
  return (p ** 4) * (1 + 4 * q + 10 * q * q) + (20 * (p ** 5) * (q ** 3)) / (p * p + q * q)
}

const isTbOver = (pointsA: number, pointsB: number, target: number) => {
  const high = Math.max(pointsA, pointsB)
  const low = Math.min(pointsA, pointsB)
  return high >= target && high - low >= 2
}

export const tiebreakWinProbability = (pointWin: number, target = 7) => {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, pointWin))
  const q = 1 - p
  const max = target + 12
  const reach = Array.from({ length: max + 1 }, () => new Array<number>(max + 1).fill(0))
  reach[0]![0] = 1
  let win = 0
  for (let sum = 0; sum <= max * 2; sum += 1) {
    for (let pointsA = Math.max(0, sum - max); pointsA <= Math.min(max, sum); pointsA += 1) {
      const pointsB = sum - pointsA
      const probability = reach[pointsA]![pointsB]!
      if (probability === 0) continue
      if (isTbOver(pointsA, pointsB, target)) {
        if (pointsA > pointsB) win += probability
        continue
      }
      if (pointsA < max) reach[pointsA + 1]![pointsB]! += probability * p
      if (pointsB < max) reach[pointsA]![pointsB + 1]! += probability * q
    }
  }
  return win
}

export const setScoreDistribution = (pointWin: number, decidingSuperTiebreak = false): TennisSetScore[] => {
  const pGame = gameWinProbability(pointWin)
  const qGame = 1 - pGame
  const pTb = tiebreakWinProbability(pointWin, decidingSuperTiebreak ? 10 : 7)
  const reach = Array.from({ length: 7 }, () => new Array<number>(7).fill(0))
  reach[0]![0] = 1
  const scores: TennisSetScore[] = []

  for (let sum = 0; sum <= 12; sum += 1) {
    for (let gamesA = 0; gamesA <= Math.min(6, sum); gamesA += 1) {
      const gamesB = sum - gamesA
      if (gamesB > 6) continue
      const probability = reach[gamesA]![gamesB]!
      if (probability === 0) continue
      if (gamesA === 6 && gamesB === 6) {
        scores.push({ gamesA: 7, gamesB: 6, probability: probability * pTb })
        scores.push({ gamesA: 6, gamesB: 7, probability: probability * (1 - pTb) })
        continue
      }
      if (gamesA === 6 && gamesB === 5) {
        scores.push({ gamesA: 7, gamesB: 5, probability: probability * pGame })
        reach[6]![6]! += probability * qGame
        continue
      }
      if (gamesA === 5 && gamesB === 6) {
        scores.push({ gamesA: 5, gamesB: 7, probability: probability * qGame })
        reach[6]![6]! += probability * pGame
        continue
      }
      if (gamesA === 6 || gamesB === 6) continue
      reach[gamesA + 1]![gamesB]! += probability * pGame
      reach[gamesA]![gamesB + 1]! += probability * qGame
    }
  }

  for (let gamesA = 6; gamesA <= 6; gamesA += 1) {
    for (let gamesB = 0; gamesB <= 4; gamesB += 1) {
      const probability = reach[gamesA]![gamesB]!
      if (probability > 0) scores.push({ gamesA, gamesB, probability })
    }
  }
  for (let gamesB = 6; gamesB <= 6; gamesB += 1) {
    for (let gamesA = 0; gamesA <= 4; gamesA += 1) {
      const probability = reach[gamesA]![gamesB]!
      if (probability > 0) scores.push({ gamesA, gamesB, probability })
    }
  }

  return scores
}

export const setWinProbability = (pointWin: number, decidingSuperTiebreak = false) =>
  setScoreDistribution(pointWin, decidingSuperTiebreak)
    .filter(score => score.gamesA > score.gamesB)
    .reduce((sum, score) => sum + score.probability, 0)

type SetWinDistributions = {
  pSetA: number
  totalA: Distribution
  totalB: Distribution
  marginA: Distribution
  marginB: Distribution
}

const computeSetDistributions = (scores: TennisSetScore[]): SetWinDistributions => {
  const winsA = scores.filter(score => score.gamesA > score.gamesB)
  const winsB = scores.filter(score => score.gamesB > score.gamesA)
  const pSetA = winsA.reduce((sum, score) => sum + score.probability, 0)
  const totalOf = (list: TennisSetScore[]) =>
    toDistribution(list.map(score => ({ value: score.gamesA + score.gamesB, probability: score.probability })))
  const marginOf = (list: TennisSetScore[]) =>
    toDistribution(list.map(score => ({ value: score.gamesA - score.gamesB, probability: score.probability })))
  return {
    pSetA,
    totalA: normalizeDistribution(totalOf(winsA)),
    totalB: normalizeDistribution(totalOf(winsB)),
    marginA: normalizeDistribution(marginOf(winsA)),
    marginB: normalizeDistribution(marginOf(winsB)),
  }
}

const bo3Distribution = (normal: SetWinDistributions, deciding: SetWinDistributions): TennisMatchDistribution => {
  const p = normal.pSetA
  const q = 1 - p
  const pDecidingA = deciding.pSetA
  const p2_0 = p * p
  const p0_2 = q * q
  const p2_1 = 2 * p * q * pDecidingA
  const p1_2 = 2 * p * q * (1 - pDecidingA)
  const totalSum = p2_0 + p2_1 + p1_2 + p0_2
  const correctScore: Partial<Record<TennisCorrectScore, number>> = {
    '2:0': p2_0 / totalSum,
    '2:1': p2_1 / totalSum,
    '1:2': p1_2 / totalSum,
    '0:2': p0_2 / totalSum,
  }

  const twoA = convolve(normal.totalA, normal.totalA)
  const twoB = convolve(normal.totalB, normal.totalB)
  const split = convolve(normal.totalA, normal.totalB)
  const total = combine([
    scale(twoA, p2_0),
    scale(convolve(split, deciding.totalA), p2_1),
    scale(convolve(split, deciding.totalB), p1_2),
    scale(twoB, p0_2),
  ])
  const twoAMargin = convolve(normal.marginA, normal.marginA)
  const twoBMargin = convolve(normal.marginB, normal.marginB)
  const splitMargin = convolve(normal.marginA, normal.marginB)
  const margin = combine([
    scale(twoAMargin, p2_0),
    scale(convolve(splitMargin, deciding.marginA), p2_1),
    scale(convolve(splitMargin, deciding.marginB), p1_2),
    scale(twoBMargin, p0_2),
  ])
  const setMargin = toDistribution([
    { value: 2, probability: correctScore['2:0'] ?? 0 },
    { value: 1, probability: correctScore['2:1'] ?? 0 },
    { value: -1, probability: correctScore['1:2'] ?? 0 },
    { value: -2, probability: correctScore['0:2'] ?? 0 },
  ])

  return {
    correctScore,
    total: normalizeDistribution(total),
    margin: normalizeDistribution(margin),
    setMargin,
    set1Total: normalizeDistribution(combine([scale(normal.totalA, p), scale(normal.totalB, q)])),
    set1Margin: normalizeDistribution(combine([scale(normal.marginA, p), scale(normal.marginB, q)])),
  }
}

const bo5Distribution = (normal: SetWinDistributions, deciding: SetWinDistributions): TennisMatchDistribution => {
  const p = normal.pSetA
  const q = 1 - p
  const pDecidingA = deciding.pSetA
  const p3_0 = p ** 3
  const p0_3 = q ** 3
  const p3_1 = 3 * (p ** 3) * q
  const p1_3 = 3 * p * (q ** 3)
  const p3_2 = 6 * (p ** 2) * (q ** 2) * pDecidingA
  const p2_3 = 6 * (p ** 2) * (q ** 2) * (1 - pDecidingA)
  const totalSum = p3_0 + p3_1 + p3_2 + p2_3 + p1_3 + p0_3
  const correctScore: Partial<Record<TennisCorrectScore, number>> = {
    '3:0': p3_0 / totalSum,
    '3:1': p3_1 / totalSum,
    '3:2': p3_2 / totalSum,
    '2:3': p2_3 / totalSum,
    '1:3': p1_3 / totalSum,
    '0:3': p0_3 / totalSum,
  }

  const threeA = convolve(convolve(normal.totalA, normal.totalA), normal.totalA)
  const threeB = convolve(convolve(normal.totalB, normal.totalB), normal.totalB)
  const twoAOneB = convolve(convolve(normal.totalA, normal.totalA), normal.totalB)
  const oneATwoB = convolve(convolve(normal.totalB, normal.totalB), normal.totalA)
  const twoATwoB = convolve(convolve(normal.totalA, normal.totalA), convolve(normal.totalB, normal.totalB))
  const total = combine([
    scale(threeA, p3_0),
    scale(convolve(twoAOneB, normal.totalA), p3_1),
    scale(convolve(twoATwoB, deciding.totalA), p3_2),
    scale(convolve(twoATwoB, deciding.totalB), p2_3),
    scale(convolve(oneATwoB, normal.totalB), p1_3),
    scale(threeB, p0_3),
  ])
  const threeAMargin = convolve(convolve(normal.marginA, normal.marginA), normal.marginA)
  const threeBMargin = convolve(convolve(normal.marginB, normal.marginB), normal.marginB)
  const twoAOneBMargin = convolve(convolve(normal.marginA, normal.marginA), normal.marginB)
  const oneATwoBMargin = convolve(convolve(normal.marginB, normal.marginB), normal.marginA)
  const twoATwoBMargin = convolve(convolve(normal.marginA, normal.marginA), convolve(normal.marginB, normal.marginB))
  const margin = combine([
    scale(threeAMargin, p3_0),
    scale(convolve(twoAOneBMargin, normal.marginA), p3_1),
    scale(convolve(twoATwoBMargin, deciding.marginA), p3_2),
    scale(convolve(twoATwoBMargin, deciding.marginB), p2_3),
    scale(convolve(oneATwoBMargin, normal.marginB), p1_3),
    scale(threeBMargin, p0_3),
  ])
  const setMargin = toDistribution([
    { value: 3, probability: correctScore['3:0'] ?? 0 },
    { value: 2, probability: correctScore['3:1'] ?? 0 },
    { value: 1, probability: correctScore['3:2'] ?? 0 },
    { value: -1, probability: correctScore['2:3'] ?? 0 },
    { value: -2, probability: correctScore['1:3'] ?? 0 },
    { value: -3, probability: correctScore['0:3'] ?? 0 },
  ])
  return {
    correctScore,
    total: normalizeDistribution(total),
    margin: normalizeDistribution(margin),
    setMargin,
    set1Total: normalizeDistribution(combine([scale(normal.totalA, p), scale(normal.totalB, q)])),
    set1Margin: normalizeDistribution(combine([scale(normal.marginA, p), scale(normal.marginB, q)])),
  }
}

export const tennisMatchDistribution = (
  pointWin: number,
  bestOf: TennisBestOf,
  grandSlamDeciding = false,
): TennisMatchDistribution => {
  const normal = computeSetDistributions(setScoreDistribution(pointWin, false))
  const deciding = computeSetDistributions(setScoreDistribution(pointWin, grandSlamDeciding && bestOf === 5))
  return bestOf === 5 ? bo5Distribution(normal, deciding) : bo3Distribution(normal, deciding)
}

export const matchWinProbability = (pointWin: number, bestOf: TennisBestOf) => {
  const p = setWinProbability(pointWin)
  const q = 1 - p
  if (bestOf === 5) return p ** 3 * (1 + 3 * q + 6 * q * q)
  return p * p * (3 - 2 * p)
}

const invertMonotone = (target: number, evaluate: (value: number) => number) => {
  let lo = 1e-6
  let hi = 1 - 1e-6
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (evaluate(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export const matchProbabilityToPoint = (matchWin: number, bestOf: TennisBestOf) =>
  invertMonotone(matchWin, pointWin => matchWinProbability(pointWin, bestOf))

export const matchProbabilityToSet1 = (matchWin: number, bestOf: TennisBestOf) =>
  setWinProbability(matchProbabilityToPoint(matchWin, bestOf))

export const tennisSetCount = (correctScore: Partial<Record<TennisCorrectScore, number>>, bestOf: TennisBestOf) => {
  if (bestOf === 5) {
    return {
      '3': (correctScore['3:0'] ?? 0) + (correctScore['0:3'] ?? 0),
      '4': (correctScore['3:1'] ?? 0) + (correctScore['1:3'] ?? 0),
      '5': (correctScore['3:2'] ?? 0) + (correctScore['2:3'] ?? 0),
    }
  }
  return {
    '2': (correctScore['2:0'] ?? 0) + (correctScore['0:2'] ?? 0),
    '3': (correctScore['2:1'] ?? 0) + (correctScore['1:2'] ?? 0),
  }
}

export const isGrandSlamDeciding = (tournament: string, bestOf: TennisBestOf) =>
  bestOf === 5 && /australian\s*open|roland\s*garros|french\s*open|wimbledon|us\s*open|澳網|法網|溫布頓|美網/i.test(tournament)

export type TennisRallyModel = {
  coefficients: RallyCoefficients
}

export type TennisRallyMatchRow = {
  eloDiff: number
  sets: Array<{ gamesA: number, gamesB: number }>
}

export const fitTennisRallyModel = (rows: TennisRallyMatchRow[]): TennisRallyModel => {
  const rallyRows: RallyRow[] = rows.flatMap(row => row.sets.map(set => ({
    eloDiff: row.eloDiff,
    pointsA: set.gamesA,
    pointsB: set.gamesB,
  })))
  return { coefficients: fitRallyLogistic(rallyRows) }
}

export const tennisCorrectScoreKeys = (bestOf: TennisBestOf): readonly TennisCorrectScore[] =>
  bestOf === 5 ? TENNIS_BO5_CORRECT_SCORES : TENNIS_BO3_CORRECT_SCORES

export { sigmoid }
