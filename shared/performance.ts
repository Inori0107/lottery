import type { TicketRecord } from './types'

export type PerformanceSummary = {
  tracked: number; legacy: number; settled: number; winRate: number | null
  staked: number; profit: number; roi: number | null; maxDrawdown: number
  averageClv: number | null
  comparison: { n: number; modelLogLoss: number | null; marketLogLoss: number | null; modelBrier: number | null }
  calibration: Array<{ label: string; n: number; predicted: number | null; actual: number | null }>
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const loss = (p: number, y: number) => -(y * Math.log(Math.max(1e-6, p)) + (1 - y) * Math.log(Math.max(1e-6, 1 - p)))

export const performanceSummary = (tickets: TicketRecord[]): PerformanceSummary => {
  const tracked = tickets.filter(t => t.legs.length > 0 && t.legs.every(l => l.quoteId))
  const settled = tracked.filter(t => t.status === 'won' || t.status === 'lost')
    .sort((a, b) => (a.settledAt ?? a.placedAt).localeCompare(b.settledAt ?? b.placedAt) || a.id.localeCompare(b.id))
  const staked = settled.reduce((s, t) => s + t.stake, 0)
  let profit = 0, peak = 0, maxDrawdown = 0
  for (const ticket of settled) {
    profit += (ticket.payout ?? 0) - ticket.stake
    peak = Math.max(peak, profit)
    maxDrawdown = Math.max(maxDrawdown, peak - profit)
  }
  // First recorded full-match badminton selection per fixture. Repeated tickets
  // and opposite sides must not inflate the apparent independent sample count.
  const seen = new Set<number>()
  const outcomes = [...tracked].sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id))
    .flatMap(t => t.legs).filter(leg => {
      if (leg.sport !== 'badminton' || leg.market !== 'match' || leg.fixtureId === null || seen.has(leg.fixtureId)
        || leg.probability === null || (leg.status !== 'won' && leg.status !== 'lost')) return false
      seen.add(leg.fixtureId)
      return true
    }).map(l => ({ p: l.probability!, market: l.marketProbability ?? null, y: l.status === 'won' ? 1 : 0 }))
  const comparison = outcomes.filter(o => o.market !== null)
  const clv = tracked.flatMap(t => t.legs).filter(l => l.status === 'won' || l.status === 'lost')
    .flatMap(l => l.clv == null ? [] : [l.clv])
  return {
    tracked: tracked.length, legacy: tickets.length - tracked.length, settled: settled.length,
    winRate: settled.length ? settled.filter(t => t.status === 'won').length / settled.length : null,
    staked, profit, roi: staked ? profit / staked : null, maxDrawdown, averageClv: mean(clv),
    comparison: { n: comparison.length, modelLogLoss: mean(comparison.map(o => loss(o.p, o.y))),
      marketLogLoss: mean(comparison.map(o => loss(o.market!, o.y))), modelBrier: mean(comparison.map(o => (o.p - o.y) ** 2)) },
    calibration: Array.from({ length: 5 }, (_, i) => {
      const group = outcomes.filter(o => o.p >= i / 5 && (o.p < (i + 1) / 5 || i === 4))
      return { label: `${i * 20}–${(i + 1) * 20}%`, n: group.length, predicted: mean(group.map(o => o.p)), actual: mean(group.map(o => o.y)) }
    }),
  }
}
