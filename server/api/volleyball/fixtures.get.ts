import type { FixtureSummary, FixturesResponse, Sport } from '../../../shared/types'
import { taipeiDate } from '../../models/ledgerStore'

export default defineEventHandler((): FixturesResponse => {
  const ledger = useLedger()
  const date = taipeiDate(new Date())

  const lastImportRow = ledger.prepare(`
    SELECT value FROM ledger_state WHERE key = 'last_tsl_import'
  `).get() as { value: string } | undefined

  const fixtures = ledger.prepare(`
    SELECT * FROM fixtures
    WHERE play_date = ? AND discipline IN ('M', 'W')
    ORDER BY starts_at, sportradar_id
  `).all(date) as Array<{
    sportradar_id: number
    discipline: 'M' | 'W'
    tournament: string
    starts_at: string
    status: 'pre' | 'live' | 'ended' | 'void'
    score: string
    away_name: string
    home_name: string
    away_name_zh: string
    home_name_zh: string
    away_team_id: string | null
    home_team_id: string | null
  }>

  const latestCapture = ledger.prepare(`SELECT MAX(captured_at) AS captured_at FROM odds_snapshots WHERE fixture_id = ?`)
  const snapshotRows = ledger.prepare(`SELECT market, outcome_key, line, odds FROM odds_snapshots WHERE fixture_id = ? AND captured_at = ?`)

  const result: FixtureSummary[] = fixtures.map((fixture) => {
    const { captured_at: capturedAt } = latestCapture.get(fixture.sportradar_id) as { captured_at: string | null }
    const rows = capturedAt ? snapshotRows.all(fixture.sportradar_id, capturedAt) as Array<{
      market: string
      outcome_key: string
      line: number | null
      odds: number
    }> : []

    const pick = (market: string, key: string) => rows.find(r => r.market === market && r.outcome_key === key)
    const pair = (market: string) => {
      const away = pick(market, 'away')
      const home = pick(market, 'home')
      return away && home ? { away: away.odds, home: home.odds } : null
    }

    return {
      sport: 'volleyball' as Sport,
      sportradarId: fixture.sportradar_id,
      discipline: fixture.discipline,
      tournament: fixture.tournament,
      startsAt: fixture.starts_at,
      status: fixture.status,
      score: fixture.score,
      awayName: fixture.away_name,
      homeName: fixture.home_name,
      awayNameZh: fixture.away_name_zh,
      homeNameZh: fixture.home_name_zh,
      away: null,
      home: null,
      odds: {
        match: pair('match'),
        set1: pair('set1'),
        totals: (() => {
          const over = pick('totals', 'over')
          const under = pick('totals', 'under')
          return over && under && over.line ? { line: over.line, over: over.odds, under: under.odds } : null
        })(),
        handicap: (() => {
          const away = pick('handicap', 'away')
          const home = pick('handicap', 'home')
          return away && home && away.line ? { homeLine: -away.line, away: away.odds, home: home.odds } : null
        })(),
        correctScore: null,
        setHandicap: (() => {
          const away = pick('setHandicap', 'away')
          const home = pick('setHandicap', 'home')
          return away && home && away.line ? { homeLine: -away.line, away: away.odds, home: home.odds } : null
        })(),
        set1Totals: (() => {
          const over = pick('set1Totals', 'over')
          const under = pick('set1Totals', 'under')
          return over && under && over.line ? { line: over.line, over: over.odds, under: under.odds } : null
        })(),
        set1Handicap: (() => {
          const away = pick('set1Handicap', 'away')
          const home = pick('set1Handicap', 'home')
          return away && home && away.line ? { homeLine: -away.line, away: away.odds, home: home.odds } : null
        })(),
      },
      oddsCapturedAt: capturedAt,
    }
  })

  return {
    date,
    lastImportAt: lastImportRow?.value ?? null,
    fixtures: result,
  }
})
