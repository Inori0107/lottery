import type { MarketQuote, ProbabilityEvidence } from './types'

export const HIGH_PROBABILITY_THRESHOLD = 0.8
export const MIN_EVIDENCE_SAMPLE = 100
export const MAX_TICKET_FRACTION = 0.01
export const MAX_DAILY_FRACTION = 0.05

export const conservativeEligibility = (quote: MarketQuote, side: 'away' | 'home') => {
  const p = side === 'away' ? quote.probabilityCalibratedAway : quote.probabilityCalibratedHome
  const implied = side === 'away' ? quote.impliedAway : quote.impliedHome
  const evidence = side === 'away' ? quote.evidenceAway : quote.evidenceHome
  const reasons: string[] = []
  if (p === null || p < HIGH_PROBABILITY_THRESHOLD) reasons.push('未達高命中觀察門檻 80%')
  if (!quote.validationReady) reasons.push('尚無足夠獨立校準與時間外驗證')
  if (!evidence || evidence.n < MIN_EVIDENCE_SAMPLE) reasons.push('同機率組驗證樣本不足 100 場')
  if (!evidence || implied === null || evidence.lower <= implied) reasons.push('歷史同機率組下界尚未高於打平門檻')
  if (quote.decision.action !== 'candidate' || quote.decision.side !== side) reasons.push(quote.decision.reason)
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] }
}

// Wilson interval of historical out-of-time outcomes in a probability group.
// This describes the group, not certainty about one player's next match.
export const probabilityEvidence = (n: number, observed: number): ProbabilityEvidence => {
  const z2 = 1.96 ** 2, denominator = 1 + z2 / n
  const center = (observed + z2 / (2 * n)) / denominator
  const radius = 1.96 * Math.sqrt(observed * (1 - observed) / n + z2 / (4 * n * n)) / denominator
  return { n, observed, lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) }
}

export const formatEvPercent = (ev: number | null) => ev === null ? '—' : `${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`
export const formatEvMoney = (ev: number | null) => ev === null ? '—' : `${ev > 0 ? '+' : ''}${(ev * 100).toFixed(2)} 元`
