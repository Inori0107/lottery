import { buildBadmintonQuote } from '../../models/badmintonQuote'
import { listFixtures, taipeiDate } from '../../models/ledgerStore'
import type { BadmintonWatchlist } from '../../../shared/types'
import { HIGH_PROBABILITY_THRESHOLD, conservativeEligibility } from '../../../shared/strategy'
import { marketIsOpen, MAX_ODDS_AGE_MS } from '../../../shared/fixtureMarkets'

export default defineEventHandler((): BadmintonWatchlist => {
  const ledger = useLedger(), sqlite = useDb().sqlite, now = Date.now()
  const fixtures = listFixtures(ledger, sqlite, taipeiDate(new Date()))
    .filter(f => f.sport === 'badminton' && f.status === 'pre' && Date.parse(f.startsAt) > now)
  const items: BadmintonWatchlist['items'] = [], skipped: BadmintonWatchlist['skipped'] = []
  for (const fixture of fixtures) {
    const title = `${fixture.awayName} 對 ${fixture.homeName}`
    const options = fixture.markets?.filter(m => m.market === 'match' && marketIsOpen(m, now)) ?? []
    const market = options.find(m => m.isMainline) ?? options[0]
    if (!fixture.away || !fixture.home || !market || !fixture.oddsCapturedAt || now - Date.parse(fixture.oddsCapturedAt) > MAX_ODDS_AGE_MS) {
      skipped.push({ title, reason: !fixture.away || !fixture.home ? '選手未完整對應' : '缺少新鮮可售的全場不讓分賠率' })
      continue
    }
    const away = market.selections.find(s => s.key === 'away')?.odds
    const home = market.selections.find(s => s.key === 'home')?.odds
    if (away == null || home == null) continue
    try {
      const quote = buildBadmintonQuote(sqlite, ledger, { fixtureId: fixture.sportradarId, discipline: fixture.discipline as 'MS' | 'WS',
        awayPlayerId: fixture.away.id, homePlayerId: fixture.home.id, matchOdds: { away, home }, sourceMarketIds: { match: market.id } })
      const q = quote.matchWinner
      if (q.probabilityCalibratedAway === null || q.probabilityCalibratedHome === null) { skipped.push({ title, reason: q.reason ?? '模型樣本不足' }); continue }
      const side = q.probabilityCalibratedAway >= q.probabilityCalibratedHome ? 'away' : 'home'
      const p = side === 'away' ? q.probabilityCalibratedAway : q.probabilityCalibratedHome
      if (p < HIGH_PROBABILITY_THRESHOLD) continue
      const eligibility = conservativeEligibility(q, side)
      items.push({ fixture, side, probability: p, odds: side === 'away' ? away : home, quote, ...eligibility })
    } catch (error) { skipped.push({ title, reason: error instanceof Error ? error.message : '無法計算' }) }
  }
  return { threshold: HIGH_PROBABILITY_THRESHOLD, considered: fixtures.length, items: items.sort((a, b) => b.probability - a.probability), skipped }
})
