import type { BetStatus, LedgerKind, ParlayQuote, SlipLeg } from './types'

export const MAX_PARLAY_LEGS = 10
export const MIN_PARLAY_LEGS = 2
export const KELLY_FRACTION = 0.25

export type ParlayError = {
  reason: string
}

export const roundOdds = (odds: number) => Math.round(odds * 100) / 100

export const combinedOdds = (legs: Array<{ odds: number }>) =>
  roundOdds(legs.reduce((product, leg) => product * leg.odds, 1))

export const combinedProbability = (legs: Array<{ probability: number | null }>) => {
  if (legs.some(leg => leg.probability === null)) return null
  return legs.reduce((product, leg) => product * (leg.probability ?? 0), 1)
}

export const parlayExpectedValue = (probability: number | null, odds: number) =>
  probability === null ? null : probability * odds - 1

export const fractionalKelly = (ev: number | null, odds: number, fraction = KELLY_FRACTION) => {
  if (ev === null || ev <= 0 || odds <= 1) return null
  return Math.max(0, (ev / (odds - 1)) * fraction)
}

export const validateParlayLegs = (legs: SlipLeg[]): ParlayError | null => {
  if (legs.length === 0) return { reason: '過關單是空的' }
  if (legs.length < MIN_PARLAY_LEGS) return { reason: `過關至少 ${MIN_PARLAY_LEGS} 腿` }
  if (legs.length > MAX_PARLAY_LEGS) return { reason: `過關最多 ${MAX_PARLAY_LEGS} 腿` }
  const fixtureIds = legs.map(leg => leg.fixtureId).filter((id): id is number => id !== null)
  if (fixtureIds.length !== legs.length) return { reason: '過關每腿都要對上運彩場次' }
  if (new Set(fixtureIds).size !== fixtureIds.length) return { reason: '同場不可串關' }
  return null
}

export const quoteParlay = (legs: SlipLeg[]): ParlayQuote | ParlayError => {
  const error = validateParlayLegs(legs)
  if (error) return error
  const odds = combinedOdds(legs)
  const probability = combinedProbability(legs)
  const ev = parlayExpectedValue(probability, odds)
  return {
    combinedOdds: odds,
    combinedProbability: probability,
    ev,
    kelly: fractionalKelly(ev, odds),
    reason: '跨場獨立假設，僅供研究；過關不當候選。',
  }
}

export const isParlayQuote = (value: ParlayQuote | ParlayError): value is ParlayQuote =>
  'combinedOdds' in value

export const suggestedStake = (
  balance: number,
  quote: ParlayQuote,
  mode: 'flat' | 'percent' | 'kelly',
  flatAmount = 100,
  percent = 0.02,
) => {
  if (mode === 'percent') return Math.max(0, Math.round(balance * percent * 100) / 100)
  if (mode === 'kelly') {
    const fraction = quote.kelly
    if (fraction === null) return 0
    return Math.max(0, Math.round(balance * fraction * 100) / 100)
  }
  return Math.min(flatAmount, balance)
}

export const canAfford = (kind: LedgerKind, balance: number, stake: number) =>
  kind !== 'sim' || stake <= balance + 1e-9

export const resolveParlayTicket = (
  legs: Array<{ status: BetStatus, odds: number }>,
  stake: number,
) => {
  if (legs.some(leg => leg.status === 'open')) {
    return { status: 'open' as const, payout: null as number | null, combinedOdds: combinedOdds(legs) }
  }
  const remaining = legs.filter(leg => leg.status !== 'void')
  if (remaining.length === 0) {
    return { status: 'void' as const, payout: stake, combinedOdds: 1 }
  }
  if (remaining.some(leg => leg.status === 'lost')) {
    return { status: 'lost' as const, payout: 0, combinedOdds: combinedOdds(remaining) }
  }
  const odds = combinedOdds(remaining)
  return { status: 'won' as const, payout: Math.round(stake * odds * 100) / 100, combinedOdds: odds }
}
