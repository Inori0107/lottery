import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  ADJUSTMENT_CATEGORIES,
  applyAdjustment,
  type AdjustmentCategory,
  type ProbabilityAdjustment,
} from '../../shared/adjustments'
import type { AdjustmentLookup } from '../../shared/analysisPack'
import type { BetMarket } from '../../shared/types'

type Sqlite = Database.Database

type Row = {
  id: string
  fixture_id: number
  market: string
  outcome_key: string
  delta_pct: number
  reason_category: AdjustmentCategory
  note: string
  created_at: string
}

const toAdjustment = (row: Row): ProbabilityAdjustment => ({
  id: row.id,
  fixtureId: row.fixture_id,
  market: row.market,
  outcomeKey: row.outcome_key,
  deltaPct: row.delta_pct,
  reasonCategory: row.reason_category,
  note: row.note,
  createdAt: row.created_at,
})

export const insertAdjustment = (ledger: Sqlite, input: {
  fixtureId: number
  market: BetMarket
  outcomeKey: string
  deltaPct: number
  reasonCategory: AdjustmentCategory
  note?: string
}) => {
  if (!ADJUSTMENT_CATEGORIES.includes(input.reasonCategory)) {
    throw new Error('請選擇調整原因類別')
  }
  if (!Number.isFinite(input.deltaPct) || input.deltaPct === 0) {
    throw new Error('調整幅度不能是 0')
  }
  const id = randomUUID()
  ledger.prepare(`
    INSERT INTO probability_adjustments (
      id, fixture_id, market, outcome_key, delta_pct, reason_category, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.fixtureId,
    input.market,
    input.outcomeKey,
    input.deltaPct,
    input.reasonCategory,
    input.note ?? '',
    new Date().toISOString(),
  )
  return getAdjustment(ledger, id)
}

export const getAdjustment = (ledger: Sqlite, id: string) => {
  const row = ledger.prepare('SELECT * FROM probability_adjustments WHERE id = ?').get(id) as Row | undefined
  return row ? toAdjustment(row) : null
}

export const listAdjustmentsForFixture = (ledger: Sqlite, fixtureId: number) =>
  (ledger.prepare(`
    SELECT * FROM probability_adjustments WHERE fixture_id = ? ORDER BY created_at DESC
  `).all(fixtureId) as Row[]).map(toAdjustment)

export const latestAdjustmentsLookup = (
  ledger: Sqlite,
  fixtureId: number,
  rawByOutcome: Array<{ market: BetMarket, outcomeKey: string, raw: number | null }>,
): AdjustmentLookup[] => {
  const latest = new Map<string, ProbabilityAdjustment>()
  for (const item of listAdjustmentsForFixture(ledger, fixtureId)) {
    const key = `${item.market}:${item.outcomeKey}`
    if (!latest.has(key)) latest.set(key, item)
  }
  return rawByOutcome.flatMap((row) => {
    const item = latest.get(`${row.market}:${row.outcomeKey}`)
    if (!item) return []
    const adjusted = applyAdjustment(row.raw, item.deltaPct)
    if (adjusted === null) return []
    return [{
      market: row.market,
      outcomeKey: row.outcomeKey,
      adjustedProbability: adjusted,
      deltaPct: item.deltaPct,
      reasonCategory: item.reasonCategory,
    }]
  })
}
