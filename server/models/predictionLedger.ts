import { randomUUID } from 'node:crypto'
import type { LedgerDatabase } from '../db/ledger'
import type { FixtureMarket, QuoteResponse, TicketLegInput } from '../../shared/types'
import { quoteSelection } from '../../shared/quoteSelection'

export const savePrediction = (ledger: LedgerDatabase, quote: QuoteResponse, fixtureId: number | null, request: unknown, sourceIds: Record<string, string> = {}) => {
  const id = randomUUID(), createdAt = new Date().toISOString()
  const marketSources: QuoteResponse['marketSources'] = {}
  const snapshot = ledger.prepare('SELECT captured_at, markets_json FROM market_snapshots WHERE fixture_id = ? ORDER BY captured_at DESC LIMIT 1').get(fixtureId) as
    { captured_at: string; markets_json: string } | undefined
  if (snapshot) for (const market of JSON.parse(snapshot.markets_json) as FixtureMarket[]) {
    if (!market.market || market.status !== 'available' || (sourceIds[market.market] && sourceIds[market.market] !== market.id)) continue
    const matches = market.selections.length > 0 && market.selections.every(s => {
      const selected = quoteSelection(quote, market.market!, s.key)
      return selected?.line === market.line && selected.odds === s.odds
    })
    if (matches && (!marketSources[market.market] || market.isMainline)) marketSources[market.market] = { marketId: market.id, capturedAt: snapshot.captured_at }
  }
  const frozen = { ...quote, marketSources, quoteId: id, quotedAt: createdAt }
  ledger.prepare('INSERT INTO prediction_snapshots (id, fixture_id, created_at, response_json, request_json) VALUES (?, ?, ?, ?, ?)')
    .run(id, fixtureId, createdAt, JSON.stringify(frozen), JSON.stringify(request))
  return frozen
}

export const readPrediction = (ledger: LedgerDatabase, id: string) => {
  const row = ledger.prepare('SELECT * FROM prediction_snapshots WHERE id = ?').get(id) as
    { fixture_id: number | null; created_at: string; response_json: string } | undefined
  return row ? { fixtureId: row.fixture_id, createdAt: row.created_at, quote: JSON.parse(row.response_json) as QuoteResponse } : null
}

export const verifyPrediction = (ledger: LedgerDatabase, leg: TicketLegInput, now = Date.now()) => {
  const saved = leg.quoteId ? readPrediction(ledger, leg.quoteId) : null
  if (!saved || saved.fixtureId !== leg.fixtureId || saved.quote.sport !== leg.sport || saved.quote.discipline !== leg.discipline)
    throw new Error('請從最新計算結果重新加入投注單，以保存賽前預測')
  const age = now - Date.parse(saved.createdAt)
  if (age < 0 || age > 30 * 60_000) throw new Error('計算結果已過期，請重新計算')
  const selected = quoteSelection(saved.quote, leg.market, leg.outcomeKey)
  if (!selected || selected.line !== leg.line || selected.odds !== leg.odds || selected.probability !== leg.probability
    || selected.action !== leg.action || saved.quote.modelVersion !== leg.modelVersion)
    throw new Error('投注內容與保存的預測不符，請重新加入')
  const source = saved.quote.marketSources?.[leg.market]
  if (!source || source.marketId !== leg.sourceMarketId || source.capturedAt !== leg.oddsCapturedAt)
    throw new Error('賠率來源與保存的預測不符，請重新計算')
  const fixture = ledger.prepare('SELECT away_player_id, home_player_id, starts_at FROM fixtures WHERE sportradar_id = ?').get(leg.fixtureId) as
    { away_player_id: string | null; home_player_id: string | null; starts_at: string } | undefined
  if (!fixture || fixture.away_player_id !== saved.quote.away.id || fixture.home_player_id !== saved.quote.home.id)
    throw new Error('場次選手已變動或尚未對應，請重新計算')
  if (fixture.starts_at !== leg.startsAt)
    throw new Error('場次資訊已變動，請重新計算')
  return { ...saved, selected }
}
