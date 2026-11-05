export type Distribution = {
  offset: number
  values: number[]
}

export const GAUSS_HERMITE_NODES = [
  { z: -2.856970013872806, weight: 0.011257411327720691 },
  { z: -1.355626179974266, weight: 0.22207592200561266 },
  { z: 0, weight: 0.5333333333333333 },
  { z: 1.355626179974266, weight: 0.22207592200561266 },
  { z: 2.856970013872806, weight: 0.011257411327720691 },
] as const

export const logit = (probability: number) => Math.log(probability / (1 - probability))

export const toDistribution = (entries: Array<{ value: number, probability: number }>): Distribution => {
  if (entries.length === 0) return { offset: 0, values: [] }
  const min = Math.min(...entries.map(entry => entry.value))
  const max = Math.max(...entries.map(entry => entry.value))
  const values = new Array<number>(max - min + 1).fill(0)
  for (const entry of entries) values[entry.value - min]! += entry.probability
  return { offset: min, values }
}

export const convolve = (left: Distribution, right: Distribution): Distribution => {
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

export const scale = (distribution: Distribution, factor: number): Distribution => ({
  offset: distribution.offset,
  values: distribution.values.map(value => value * factor),
})

export const combine = (distributions: Distribution[]): Distribution => {
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

export const totalMass = (distribution: Distribution) =>
  distribution.values.reduce((sum, value) => sum + value, 0)

export const normalizeDistribution = (distribution: Distribution): Distribution => {
  const sum = totalMass(distribution)
  if (sum === 0 || sum === 1) return distribution
  return { offset: distribution.offset, values: distribution.values.map(value => value / sum) }
}

export const probabilityAbove = (distribution: Distribution, line: number) =>
  distribution.values.reduce((sum, probability, index) => (
    distribution.offset + index > line ? sum + probability : sum
  ), 0)

export const distributionMean = (distribution: Distribution) =>
  distribution.values.reduce((sum, probability, index) => sum + probability * (distribution.offset + index), 0)

const halfLines = (distribution: Distribution) =>
  distribution.values.map((_, index) => distribution.offset + index + 0.5)

export const linesWithin = (distribution: Distribution, low: number, high: number) =>
  halfLines(distribution).filter((line) => {
    const probability = probabilityAbove(distribution, line)
    return probability >= low && probability <= high
  })

export const fairLine = (distribution: Distribution) => {
  const lines = halfLines(distribution)
  let best = lines[0] ?? 0.5
  let bestGap = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const gap = Math.abs(probabilityAbove(distribution, line) - 0.5)
    if (gap < bestGap) {
      best = line
      bestGap = gap
    }
  }
  return best
}

export const coversHandicap = (margin: Distribution, handicap: number) =>
  probabilityAbove(margin, -handicap)
