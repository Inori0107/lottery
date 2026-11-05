import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { evaluateParlay, type ParlayLeg } from '../../shared/parlay'
import { getSportForDiscipline } from '../../shared/sports'
import type { BetStatus, FixtureStatus } from '../../shared/types'
import { markPredictionPlaced } from './predictions'
import { betPayout, parseGameScores, settleBet, settleParlayStatus } from './settle'

type Sqlite = Database.Database

export type PlacedParlay = {
  id: string
  stake: number
  combinedOdds: number
  combinedEv: number | null
  status: BetStatus
  payout: number | null
  placedAt: string
  settledAt: string | null
  note: string
  legs: ParlayLeg[]
}

type ParlayRow = {
  id: string
  stake: number
  combined_odds: number
  combined_ev: number | null
  status: BetStatus
  payout: number | null
  placed_at: string
  settled_at: string | null
  note: string
}

type LegRow = {
  parlay_id: string
  position: number
  fixture_id: number | null
  sport: ParlayLeg['sport'] | null
  discipline: ParlayLeg['discipline']
  tournament: string
  round: string
  away_name: string
  home_name: string
  market: ParlayLeg['market']
  outcome_key: string
  outcome_label: string
  line: number | null
  odds: number
  probability: number | null
  probability_source: 'model' | 'market'
  data_sufficient: number
  status: BetStatus
}

const toLeg = (row: LegRow): ParlayLeg => ({
  id: `${row.parlay_id}:${row.position}`,
  fixtureId: row.fixture_id,
  sport: row.sport ?? 'badminton',
  discipline: row.discipline,
  tournament: row.tournament,
  round: row.round,
  awayName: row.away_name,
  homeName: row.home_name,
  market: row.market,
  outcomeKey: row.outcome_key,
  outcomeLabel: row.outcome_label,
  line: row.line,
  odds: row.odds,
  probability: row.probability,
  probabilitySource: row.probability_source,
  dataSufficient: row.data_sufficient === 1,
  startsAt: null,
})

export const insertParlay = (ledger: Sqlite, input: { legs: ParlayLeg[], stake: number, note?: string }) => {
  if (input.legs.length < 2) throw new Error('過關至少兩腳')
  if (!(input.stake > 0)) throw new Error('金額要大於 0')
  const evaluation = evaluateParlay(input.legs)
  const id = randomUUID()
  const placedAt = new Date().toISOString()
  ledger.transaction(() => {
    ledger.prepare(`
      INSERT INTO parlays (id, stake, combined_odds, combined_ev, status, placed_at, note)
      VALUES (?, ?, ?, ?, 'open', ?, ?)
    `).run(id, input.stake, evaluation.combinedOdds, evaluation.ev, placedAt, input.note ?? '')
    const insertLeg = ledger.prepare(`
      INSERT INTO parlay_legs (
        parlay_id, position, fixture_id, sport, discipline, tournament, round,
        away_name, home_name, market, outcome_key, outcome_label, line, odds,
        probability, probability_source, data_sufficient
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    input.legs.forEach((leg, position) => {
      insertLeg.run(
        id,
        position,
        leg.fixtureId,
        leg.sport,
        leg.discipline,
        leg.tournament,
        leg.round,
        leg.awayName,
        leg.homeName,
        leg.market,
        leg.outcomeKey,
        leg.outcomeLabel,
        leg.line,
        leg.odds,
        leg.probability,
        leg.probabilitySource,
        leg.dataSufficient ? 1 : 0,
      )
      if (leg.fixtureId !== null) {
        markPredictionPlaced(ledger, {
          fixtureId: leg.fixtureId,
          market: leg.market,
          outcomeKey: leg.outcomeKey,
          parlayId: id,
        })
      }
    })
  })()
  return getParlay(ledger, id)
}

export const getParlay = (ledger: Sqlite, id: string): PlacedParlay | null => {
  const row = ledger.prepare('SELECT * FROM parlays WHERE id = ?').get(id) as ParlayRow | undefined
  if (!row) return null
  const legs = (ledger.prepare('SELECT * FROM parlay_legs WHERE parlay_id = ? ORDER BY position').all(id) as LegRow[]).map(toLeg)
  return {
    id: row.id,
    stake: row.stake,
    combinedOdds: row.combined_odds,
    combinedEv: row.combined_ev,
    status: row.status,
    payout: row.payout,
    placedAt: row.placed_at,
    settledAt: row.settled_at,
    note: row.note,
    legs,
  }
}

export const listParlays = (ledger: Sqlite): PlacedParlay[] => {
  const rows = ledger.prepare('SELECT id FROM parlays ORDER BY placed_at DESC').all() as Array<{ id: string }>
  return rows.flatMap(row => {
    const parlay = getParlay(ledger, row.id)
    return parlay ? [parlay] : []
  })
}

export const listOpenParlays = (ledger: Sqlite) => listParlays(ledger).filter(parlay => parlay.status === 'open')

export const settleOpenParlays = (ledger: Sqlite) => {
  const open = listOpenParlays(ledger)
  const fixtureStmt = ledger.prepare('SELECT status, score, discipline FROM fixtures WHERE sportradar_id = ?')
  const updateParlay = ledger.prepare('UPDATE parlays SET status = ?, payout = ?, settled_at = ? WHERE id = ?')
  const updateLeg = ledger.prepare('UPDATE parlay_legs SET status = ? WHERE parlay_id = ? AND position = ?')
  const settledAt = new Date().toISOString()
  let settled = 0
  ledger.transaction(() => {
    for (const parlay of open) {
      const legStatuses: BetStatus[] = parlay.legs.map((leg, position) => {
        if (leg.fixtureId === null) return 'open'
        const fixture = fixtureStmt.get(leg.fixtureId) as { status: FixtureStatus, score: string, discipline: string } | undefined
        if (!fixture || fixture.status === 'pre' || fixture.status === 'live') return 'open'
        if (fixture.status === 'void') {
          updateLeg.run('void', parlay.id, position)
          return 'void'
        }
        const status = settleBet(
          { market: leg.market, outcomeKey: leg.outcomeKey, line: leg.line },
          parseGameScores(fixture.score),
          getSportForDiscipline(fixture.discipline as ParlayLeg['discipline']),
        )
        updateLeg.run(status, parlay.id, position)
        return status
      })
      const status = settleParlayStatus(legStatuses)
      if (status === 'open') continue
      updateParlay.run(status, betPayout(status, parlay.stake, parlay.combinedOdds), settledAt, parlay.id)
      settled += 1
    }
  })()
  return settled
}
