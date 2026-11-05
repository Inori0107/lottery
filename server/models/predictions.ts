import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { FixtureSummary, QuoteResponse } from '../../shared/types'
import { latestAdjustmentsLookup } from './adjustments'
import { quoteOutcomeRows } from './quoteOutcomes'

type Sqlite = Database.Database

export type PredictionSnapshot = {
  id: string
  fixtureId: number
  predictedAt: string
  sport: string
  discipline: string
  tournament: string
  market: string
  outcomeKey: string
  outcomeLabel: string
  line: number | null
  modelRaw: number | null
  qualitativeAdjusted: number | null
  marketVigRemoved: number | null
  modelBlended: number | null
  blendWeightMarket: number | null
  blendWeightModel: number | null
  calibrationMode: string | null
  divergencePp: number | null
  odds: number | null
  oddsCapturedAt: string | null
  decisionAction: string
  dataSufficient: boolean
  modelVersion: string | null
  sampleAway: number | null
  sampleHome: number | null
  betId: string | null
  parlayId: string | null
  placed: boolean
}

type Row = {
  id: string
  fixture_id: number
  predicted_at: string
  sport: string
  discipline: string
  tournament: string
  market: string
  outcome_key: string
  outcome_label: string
  line: number | null
  model_raw: number | null
  qualitative_adjusted: number | null
  market_vig_removed: number | null
  model_blended: number | null
  blend_weight_market: number | null
  blend_weight_model: number | null
  calibration_mode: string | null
  divergence_pp: number | null
  odds: number | null
  odds_captured_at: string | null
  decision_action: string
  data_sufficient: number
  model_version: string | null
  sample_away: number | null
  sample_home: number | null
  bet_id: string | null
  parlay_id: string | null
  placed: number
}

export const toPrediction = (row: Row): PredictionSnapshot => ({
  id: row.id,
  fixtureId: row.fixture_id,
  predictedAt: row.predicted_at,
  sport: row.sport,
  discipline: row.discipline,
  tournament: row.tournament,
  market: row.market,
  outcomeKey: row.outcome_key,
  outcomeLabel: row.outcome_label,
  line: row.line,
  modelRaw: row.model_raw,
  qualitativeAdjusted: row.qualitative_adjusted,
  marketVigRemoved: row.market_vig_removed,
  modelBlended: row.model_blended,
  blendWeightMarket: row.blend_weight_market,
  blendWeightModel: row.blend_weight_model,
  calibrationMode: row.calibration_mode,
  divergencePp: row.divergence_pp,
  odds: row.odds,
  oddsCapturedAt: row.odds_captured_at,
  decisionAction: row.decision_action,
  dataSufficient: row.data_sufficient === 1,
  modelVersion: row.model_version,
  sampleAway: row.sample_away,
  sampleHome: row.sample_home,
  betId: row.bet_id,
  parlayId: row.parlay_id,
  placed: row.placed === 1,
})

export const recordPredictionSnapshot = (
  ledger: Sqlite,
  fixture: FixtureSummary,
  quote: QuoteResponse,
  predictedAt = new Date().toISOString(),
) => {
  const rows = quoteOutcomeRows(quote)
  const adjustments = latestAdjustmentsLookup(
    ledger,
    fixture.sportradarId,
    rows.map(row => ({ market: row.market, outcomeKey: row.outcomeKey, raw: row.modelRaw })),
  )
  const insert = ledger.prepare(`
    INSERT INTO review_snapshots (
      id, fixture_id, predicted_at, sport, discipline, tournament, market, outcome_key, outcome_label,
      line, model_raw, qualitative_adjusted, market_vig_removed, model_blended, blend_weight_market,
      blend_weight_model, calibration_mode, divergence_pp, odds, odds_captured_at, decision_action,
      data_sufficient, model_version, sample_away, sample_home, placed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `)
  ledger.transaction(() => {
    for (const row of rows) {
      const adjustment = adjustments.find(item => item.market === row.market && item.outcomeKey === row.outcomeKey)
      insert.run(
        randomUUID(),
        fixture.sportradarId,
        predictedAt,
        quote.sport,
        quote.discipline,
        fixture.tournament,
        row.market,
        row.outcomeKey,
        row.outcomeLabel,
        row.line,
        row.modelRaw,
        adjustment?.adjustedProbability ?? null,
        row.marketVigRemoved,
        row.modelBlended,
        row.blendWeightMarket,
        row.blendWeightModel,
        row.calibrationMode,
        row.divergencePp,
        row.odds,
        fixture.oddsCapturedAt,
        row.decisionAction,
        row.dataSufficient ? 1 : 0,
        quote.modelVersion,
        quote.away.matchCount,
        quote.home.matchCount,
      )
    }
  })()
  return rows.length
}

export const markPredictionPlaced = (
  ledger: Sqlite,
  input: { fixtureId: number, market: string, outcomeKey: string, betId?: string, parlayId?: string },
) => {
  const latest = ledger.prepare(`
    SELECT id FROM review_snapshots
    WHERE fixture_id = ? AND market = ? AND outcome_key = ?
    ORDER BY predicted_at DESC LIMIT 1
  `).get(input.fixtureId, input.market, input.outcomeKey) as { id: string } | undefined
  if (!latest) return false
  ledger.prepare(`
    UPDATE review_snapshots SET placed = 1, bet_id = COALESCE(?, bet_id), parlay_id = COALESCE(?, parlay_id)
    WHERE id = ?
  `).run(input.betId ?? null, input.parlayId ?? null, latest.id)
  return true
}

export const listPredictionSnapshots = (ledger: Sqlite) =>
  (ledger.prepare('SELECT * FROM review_snapshots ORDER BY predicted_at').all() as Row[]).map(toPrediction)
