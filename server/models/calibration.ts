import { calibrateProbability, type CalibrationBin } from '../../shared/decision'

// Pool adjacent violators, weighted by calibration observations. Empty bins
// remain empty; test observations never enter this fit.
export const fitMonotoneCalibration = (bins: CalibrationBin[]): CalibrationBin[] => {
  const points = bins.filter(b => b.n > 0 && b.predicted !== null && b.actual !== null)
    .sort((a, b) => a.predicted! - b.predicted!)
  const blocks: Array<{ indices: number[]; weight: number; successes: number }> = []
  points.forEach((bin, index) => {
    blocks.push({ indices: [index], weight: bin.n, successes: bin.actual! * bin.n })
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!, left = blocks[blocks.length - 2]!
      if (left.successes / left.weight <= right.successes / right.weight) break
      blocks.splice(-2, 2, { indices: [...left.indices, ...right.indices], weight: left.weight + right.weight, successes: left.successes + right.successes })
    }
  })
  const fitted = new Map<CalibrationBin, number>()
  for (const block of blocks) for (const index of block.indices) fitted.set(points[index]!, block.successes / block.weight)
  return bins.map(bin => ({ ...bin, actual: fitted.get(bin) ?? bin.actual }))
}

export const calibrateSide = (p: number, bins: CalibrationBin[] = [], positiveIsSideA = true) =>
  positiveIsSideA ? calibrateProbability(p, bins) : 1 - calibrateProbability(1 - p, bins)

export type CalibrationSet = Partial<Record<'match' | 'game1' | 'totals' | 'handicap' | 'correctScore', CalibrationBin[]>>

// Legacy test calibration describes test outcomes, and must not be deployed.
export const deployableCalibration = (payload: { evaluationProtocol?: string; calibration?: CalibrationSet }): CalibrationSet =>
  payload.evaluationProtocol === 'temporal-calibration-v1' ? payload.calibration ?? {} : {}
