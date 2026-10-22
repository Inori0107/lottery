import type { Game1Method } from '../../shared/types'
import type { CalibrationBin } from '../../shared/decision'

export type { Game1Method, CalibrationBin }

export type ProbabilityBin = {
  lo: number | null
  hi: number | null
  p: number
  n: number
}

export type LogisticCoefficients = [number, number, number]

export type LabeledRow = {
  eloDiff: number
  formDiff: number
  y: number
  pMatch: number
}

const clip = (probability: number) => Math.min(1 - 1e-6, Math.max(1e-6, probability))

export const shrunkWinRate = (results: readonly number[]) => {
  const recent = results.slice(-10)
  const wins = recent.reduce((sum, value) => sum + value, 0)
  return (wins + 2) / (recent.length + 4)
}

export const sigmoid = (value: number) => {
  if (value >= 0) {
    const exp = Math.exp(-value)
    return 1 / (1 + exp)
  }
  const exp = Math.exp(value)
  return exp / (1 + exp)
}

export const logLoss = (probability: number, outcome: number) => {
  const p = clip(probability)
  return -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p))
}

export const brierScore = (probability: number, outcome: number) =>
  (probability - outcome) ** 2

export const mean = (values: number[]) => {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const solve3 = (matrix: number[][], vector: number[]) => {
  const rows = matrix.map((row, index) => [...row, vector[index] ?? 0])

  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row]?.[column] ?? 0) > Math.abs(rows[pivot]?.[column] ?? 0)) pivot = row
    }

    const pivotRow = rows[pivot]
    const columnRow = rows[column]
    if (!pivotRow || !columnRow || Math.abs(pivotRow[column] ?? 0) < 1e-12) return null

    rows[pivot] = columnRow
    rows[column] = pivotRow
    const divisor = rows[column]?.[column] ?? 0

    for (let index = column; index < 4; index += 1) {
      const current = rows[column]
      if (current) current[index] = (current[index] ?? 0) / divisor
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = rows[row]?.[column] ?? 0
      for (let index = column; index < 4; index += 1) {
        const current = rows[row]
        const source = rows[column]
        if (current && source) current[index] = (current[index] ?? 0) - factor * (source[index] ?? 0)
      }
    }
  }

  return [rows[0]?.[3] ?? 0, rows[1]?.[3] ?? 0, rows[2]?.[3] ?? 0] as LogisticCoefficients
}

export const fitLogistic = (rows: LabeledRow[]) => {
  let coefficients: LogisticCoefficients = [0, 0, 0]
  const ridge = 1e-3

  for (let iteration = 0; iteration < 30; iteration += 1) {
    const hessian = [
      [ridge, 0, 0],
      [0, ridge, 0],
      [0, 0, ridge],
    ]
    const gradient = [0, 0, 0]

    for (const row of rows) {
      const features = [1, row.eloDiff, row.formDiff]
      const linear = coefficients[0] * features[0]! + coefficients[1] * features[1]! + coefficients[2] * features[2]!
      const probability = clip(sigmoid(linear))
      const weight = probability * (1 - probability)

      for (let i = 0; i < 3; i += 1) {
        gradient[i] = (gradient[i] ?? 0) + features[i]! * (row.y - probability)
        for (let j = 0; j < 3; j += 1) {
          const line = hessian[i]
          if (line) line[j] = (line[j] ?? 0) + weight * features[i]! * features[j]!
        }
      }
    }

    const step = solve3(hessian, gradient)
    if (!step) break
    coefficients = [
      coefficients[0] + step[0],
      coefficients[1] + step[1],
      coefficients[2] + step[2],
    ]
    if (Math.hypot(step[0], step[1], step[2]) < 1e-8) break
  }

  return coefficients
}

export const buildBins = (rows: LabeledRow[]): ProbabilityBin[] => {
  const edges = [-400, -320, -240, -160, -80, 0, 80, 160, 240, 320, 400]
  const bounds: Array<number | null> = [null, ...edges, null]
  const bins: ProbabilityBin[] = []

  for (let index = 0; index < bounds.length - 1; index += 1) {
    const lo = bounds[index] ?? null
    const hi = bounds[index + 1] ?? null
    const inside = rows.filter((row) => {
      const above = lo === null || row.eloDiff >= lo
      const below = hi === null || row.eloDiff < hi
      return above && below
    })
    const wins = inside.reduce((sum, row) => sum + row.y, 0)
    bins.push({
      lo,
      hi,
      n: inside.length,
      p: (wins + 2) / (inside.length + 4),
    })
  }

  return bins
}

export const predictLogistic = (coefficients: LogisticCoefficients, eloDiff: number, formDiff: number) =>
  sigmoid(coefficients[0] + coefficients[1] * eloDiff + coefficients[2] * formDiff)

export const predictBin = (bins: ProbabilityBin[], eloDiff: number) => {
  const found = bins.find((bin) => {
    const above = bin.lo === null || eloDiff >= bin.lo
    const below = bin.hi === null || eloDiff < bin.hi
    return above && below
  })
  return found?.p ?? 0.5
}

export const matchProbabilityToGame1 = (matchProbability: number) => {
  const target = clip(matchProbability)
  let lo = 0
  let hi = 1
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (lo + hi) / 2
    const predicted = mid * mid * (3 - 2 * mid)
    if (predicted < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export const clampGame1ToMatch = (game1Probability: number, matchProbability: number) => {
  const favoriteMatch = Math.max(matchProbability, 1 - matchProbability)
  const favoriteGame1 = Math.max(game1Probability, 1 - game1Probability)
  if (favoriteGame1 > favoriteMatch) return matchProbabilityToGame1(matchProbability)
  return game1Probability
}

export const selectGame1Method = (
  logisticLogLoss: number,
  binLogLoss: number,
  matchEloLogLoss: number,
  bo3LogLoss: number,
): Game1Method => {
  const options: Array<{ method: Game1Method, loss: number }> = [
    { method: 'bins', loss: binLogLoss },
    { method: 'bo3', loss: bo3LogLoss },
  ]
  if (logisticLogLoss < matchEloLogLoss) {
    options.push({ method: 'logistic', loss: logisticLogLoss })
  }
  options.sort((left, right) => left.loss - right.loss || left.method.localeCompare(right.method))
  return options[0]?.method ?? 'bins'
}

export const calibrationBins = (
  rows: Array<{ p: number, y: number }>,
  binCount = 10,
): CalibrationBin[] =>
  Array.from({ length: binCount }, (_, index) => {
    const lo = index / binCount
    const hi = (index + 1) / binCount
    const inside = rows.filter((row) => (
      index === binCount - 1
        ? row.p >= lo && row.p <= hi
        : row.p >= lo && row.p < hi
    ))
    const n = inside.length
    if (n === 0) return { lo, hi, n, predicted: null, actual: null }
    return {
      lo,
      hi,
      n,
      predicted: inside.reduce((sum, row) => sum + row.p, 0) / n,
      actual: inside.reduce((sum, row) => sum + row.y, 0) / n,
    }
  })

export const averageLogLoss = (rows: LabeledRow[], probability: (row: LabeledRow) => number) =>
  mean(rows.map(row => logLoss(probability(row), row.y)))

export const averageBrier = (rows: LabeledRow[], probability: (row: LabeledRow) => number) =>
  mean(rows.map(row => brierScore(probability(row), row.y)))
