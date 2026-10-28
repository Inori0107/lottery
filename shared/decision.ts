import type { MarketAction, MarketDecision, MarketSide, OutcomeDecision } from './types'

export type CalibrationBin = {
  lo: number
  hi: number
  n: number
  predicted: number | null
  actual: number | null
}

export const MARKET_GAP_THRESHOLD = 0.10
export const MIN_CANDIDATE_EV = 0.05
export const MIN_GAME1_CANDIDATE_EV = 0.08
export const MIN_POINTS_CANDIDATE_EV = 0.08
export const MIN_CANDIDATE_SAMPLE = 40
export const GAME1_CAUTION = '第一局測試誤差較大'
export const POINTS_CAUTION = '分數模型沒有真實盤口回測'

export const marketActionLabel: Record<MarketAction, string> = {
  pass: '不投',
  watch: '觀望',
  candidate: '候選',
}

export const marketActionBadgeClass: Record<MarketAction, string> = {
  pass: 'bg-stone-100 text-stone-800',
  watch: 'bg-amber-100 text-amber-950',
  candidate: 'bg-emerald-100 text-emerald-900',
}

export const isHalfLine = (line: number) =>
  Number.isFinite(line) && Number.isInteger(line * 2) && !Number.isInteger(line)

type CalibrationPoint = { predicted: number, actual: number }

const clampProbability = (value: number) => Math.min(0.999, Math.max(0.001, value))

const interpolate = (left: CalibrationPoint, right: CalibrationPoint, value: number) => {
  const span = right.predicted - left.predicted
  if (span === 0) return left.actual
  return left.actual + ((value - left.predicted) / span) * (right.actual - left.actual)
}

export const calibrateProbability = (
  probability: number,
  bins: Array<{ predicted: number | null, actual: number | null }>,
) => {
  const points = bins
    .filter((bin): bin is CalibrationPoint => (
      bin.predicted !== null
      && bin.actual !== null
      && Number.isFinite(bin.predicted)
      && Number.isFinite(bin.actual)
    ))
    .sort((left, right) => left.predicted - right.predicted)

  if (points.length === 0) return probability

  if (points.length === 1) {
    const only = points[0]
    if (probability <= only.predicted) {
      return clampProbability(interpolate({ predicted: 0, actual: 0 }, only, probability))
    }
    return clampProbability(interpolate(only, { predicted: 1, actual: 1 }, probability))
  }

  if (probability <= points[0].predicted) {
    return clampProbability(interpolate(points[0], points[1], probability))
  }

  const last = points[points.length - 1]
  if (probability >= last.predicted) {
    return clampProbability(interpolate(points[points.length - 2], last, probability))
  }

  for (let index = 1; index < points.length; index += 1) {
    if (probability <= points[index].predicted) {
      return clampProbability(interpolate(points[index - 1], points[index], probability))
    }
  }

  return probability
}

export type MarketActionInput = {
  evAway: number | null
  evHome: number | null
  probabilityAway: number | null
  probabilityHome: number | null
  marketAway: number | null
  marketHome: number | null
  minEv: number
  sampleOk: boolean
  dataLagOk: boolean
  staleOk: boolean
  isGame1?: boolean
  awayName?: string
  homeName?: string
}

export type OutcomeActionOutcome = {
  key: string
  ev: number | null
  probability: number | null
  market: number | null
  name?: string
}

export type OutcomeActionInput = {
  outcomes: OutcomeActionOutcome[]
  minEv: number
  sampleOk: boolean
  dataLagOk: boolean
  staleOk: boolean
  caution?: string
  allowCandidate?: boolean
}

export const outcomeAction = (input: OutcomeActionInput): OutcomeDecision => {
  if (input.outcomes.length === 0 || input.outcomes.some(outcome => outcome.ev === null)) {
    return { action: 'pass', outcomeKey: null, reason: '沒有賠率，無法估計期望值' }
  }

  const best = [...input.outcomes].sort((left, right) => (
    (right.ev ?? 0) - (left.ev ?? 0) || (right.probability ?? 0) - (left.probability ?? 0)
  ))[0]!
  const expectedValue = best.ev ?? 0
  if (expectedValue <= 0) {
    const reason = input.outcomes.length === 2 ? '兩側校準期望值皆為負' : '所有選項校準期望值皆為負'
    return { action: 'pass', outcomeKey: null, reason }
  }

  const gap = best.probability === null || best.market === null ? null : Math.abs(best.probability - best.market)
  const watch = (reason: string): OutcomeDecision => ({ action: 'watch', outcomeKey: best.key, reason })

  if (input.allowCandidate === false) {
    return watch(input.caution ?? '算式為正，但還沒有真實盤口回測')
  }
  if (!input.sampleOk) return watch('算式為正，但樣本不足')
  if (!input.dataLagOk) return watch('算式為正，但資料過舊')
  if (!input.staleOk) return watch('算式為正，但選手停賽過久')
  if (gap !== null && gap > MARKET_GAP_THRESHOLD) return watch('算式為正，但與盤口差距大')
  if (expectedValue < input.minEv) {
    return watch(input.caution ? `算式為正，但${input.caution}` : '算式為正，但優勢太薄')
  }

  const suffix = input.caution ? `（${input.caution}）` : ''
  const detail = `校準機率高於盈虧兩平，優勢足夠${suffix}`
  return { action: 'candidate', outcomeKey: best.key, reason: best.name ? `${best.name}：${detail}` : detail }
}

export const marketAction = (input: MarketActionInput): MarketDecision => {
  const decision = outcomeAction({
    outcomes: [
      { key: 'away', ev: input.evAway, probability: input.probabilityAway, market: input.marketAway, name: input.awayName },
      { key: 'home', ev: input.evHome, probability: input.probabilityHome, market: input.marketHome, name: input.homeName },
    ],
    minEv: input.minEv,
    sampleOk: input.sampleOk,
    dataLagOk: input.dataLagOk,
    staleOk: input.staleOk,
    caution: input.isGame1 ? GAME1_CAUTION : undefined,
  })
  return {
    action: decision.action,
    side: decision.outcomeKey as MarketSide | null,
    reason: decision.reason,
  }
}
