import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BetAction,
  BetMarket,
  BetRecord,
  BetStatus,
  CorrectScore,
  Discipline,
  FixtureOdds,
  FixtureStatus,
  FixtureSummary,
  FixturesResponse,
  MatchConfidence,
  NewBetInput,
  Participant,
  PlayerOption,
  TslImportSummary,
} from '../../shared/types'
import { existingColumn, tableExists as sqliteTableExists } from '../db/columns'
import { CORRECT_SCORES } from '../../shared/types'
import { getSportForDiscipline } from '../../shared/sports'
import { addCalendarDays, belongsOnTaipeiListingDay, taipeiDate } from '../../shared/tslTime'
import { markPredictionPlaced } from './predictions'
import { betPayout, closingLineValue, closingOdds, formatGameScores, parseGameScores, settleBet, type OddsSnapshot } from './settle'
import { type StatshubMatch } from './statshub'
import {
  confirmCompetitorSide,
  ensureCompetitorMap,
  loadKnownIds,
  resolveCompetitorSide,
  type CompetitorSide,
} from './competitorMap'
import type { TslFixture } from './tsl'

type Sqlite = Database.Database

export { taipeiDate } from '../../shared/tslTime'

type FixtureRow = {
  sportradar_id: number
  tsl_event_id: string
  discipline: Discipline
  tournament: string
  starts_at: string
  play_date: string
  away_name: string
  home_name: string
  away_name_zh: string
  home_name_zh: string
  away_uid: number | null
  home_uid: number | null
  away_player_id: string | null
  home_player_id: string | null
  away_match_status: MatchConfidence | null
  home_match_status: MatchConfidence | null
  away_suggested_id: string | null
  home_suggested_id: string | null
  status: FixtureStatus
  score: string
}

export type ImportSummary = {
  fixtures: number
  snapshots: number
  unlinked: string[]
  pending: number
}

export const importTslFixtures = (
  ledger: Sqlite,
  fixtures: TslFixture[],
  mainSqlite: Sqlite | null,
  capturedAt: string,
): ImportSummary => {
  ensureCompetitorMap(ledger)
  const findBySr = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?')
  const findByTsl = ledger.prepare('SELECT * FROM fixtures WHERE tsl_event_id = ?')
  const upsert = ledger.prepare(`
    INSERT INTO fixtures (
      sportradar_id, tsl_event_id, discipline, tournament, starts_at, play_date,
      away_name, home_name, away_name_zh, home_name_zh, away_uid, home_uid,
      away_player_id, home_player_id, away_match_status, home_match_status,
      away_suggested_id, home_suggested_id, updated_at
    ) VALUES (
      @sportradarId, @tslEventId, @discipline, @tournament, @startsAt, @playDate,
      @awayName, @homeName, @awayNameZh, @homeNameZh, @awayUid, @homeUid,
      @awayPlayerId, @homePlayerId, @awayMatchStatus, @homeMatchStatus,
      @awaySuggestedId, @homeSuggestedId, @updatedAt
    )
    ON CONFLICT (sportradar_id) DO UPDATE SET
      tsl_event_id = excluded.tsl_event_id,
      discipline = excluded.discipline,
      tournament = excluded.tournament,
      starts_at = excluded.starts_at,
      play_date = excluded.play_date,
      away_name = excluded.away_name,
      home_name = excluded.home_name,
      away_name_zh = excluded.away_name_zh,
      home_name_zh = excluded.home_name_zh,
      away_uid = COALESCE(excluded.away_uid, fixtures.away_uid),
      home_uid = COALESCE(excluded.home_uid, fixtures.home_uid),
      away_player_id = excluded.away_player_id,
      home_player_id = excluded.home_player_id,
      away_match_status = excluded.away_match_status,
      home_match_status = excluded.home_match_status,
      away_suggested_id = excluded.away_suggested_id,
      home_suggested_id = excluded.home_suggested_id,
      updated_at = excluded.updated_at
  `)
  const insertSnapshot = ledger.prepare(`
    INSERT OR IGNORE INTO odds_snapshots (fixture_id, market, outcome_key, line, odds, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const knownCache = new Map<Discipline, ReturnType<typeof loadKnownIds>>()
  const knownFor = (discipline: Discipline) => {
    const cached = knownCache.get(discipline)
    if (cached) return cached
    const known = loadKnownIds(mainSqlite, discipline)
    knownCache.set(discipline, known)
    return known
  }

  const unlinked: string[] = []
  let pending = 0
  let snapshots = 0
  ledger.transaction(() => {
    for (const fixture of fixtures) {
      const existing = (findByTsl.get(fixture.tslEventId) ?? findBySr.get(fixture.sportradarId)) as FixtureRow | undefined
      const sportradarId = existing?.sportradar_id ?? fixture.sportradarId
      const known = knownFor(fixture.discipline)
      const away = resolveCompetitorSide(ledger, known, {
        sport: fixture.sport,
        discipline: fixture.discipline,
        tslEventId: fixture.tslEventId,
        side: 'away',
        sportradarUid: existing?.away_uid ?? null,
        names: [fixture.awayName, fixture.awayNameZh],
        existingPlayerId: existing?.away_player_id ?? null,
        existingStatus: existing?.away_match_status ?? null,
      })
      const home = resolveCompetitorSide(ledger, known, {
        sport: fixture.sport,
        discipline: fixture.discipline,
        tslEventId: fixture.tslEventId,
        side: 'home',
        sportradarUid: existing?.home_uid ?? null,
        names: [fixture.homeName, fixture.homeNameZh],
        existingPlayerId: existing?.home_player_id ?? null,
        existingStatus: existing?.home_match_status ?? null,
      })
      if (away.status === 'pending') {
        pending += 1
        unlinked.push(fixture.awayName)
      }
      if (home.status === 'pending') {
        pending += 1
        unlinked.push(fixture.homeName)
      }
      upsert.run({
        sportradarId,
        tslEventId: fixture.tslEventId,
        discipline: fixture.discipline,
        tournament: fixture.tournament,
        startsAt: fixture.startsAt,
        playDate: taipeiDate(new Date(fixture.startsAt)),
        awayName: fixture.awayName,
        homeName: fixture.homeName,
        awayNameZh: fixture.awayNameZh,
        homeNameZh: fixture.homeNameZh,
        awayUid: existing?.away_uid ?? null,
        homeUid: existing?.home_uid ?? null,
        awayPlayerId: away.playerId,
        homePlayerId: home.playerId,
        awayMatchStatus: away.status,
        homeMatchStatus: home.status,
        awaySuggestedId: away.suggestedId,
        homeSuggestedId: home.suggestedId,
        updatedAt: capturedAt,
      })
      if (capturedAt >= fixture.startsAt) continue
      for (const row of fixture.rows) {
        snapshots += insertSnapshot.run(sportradarId, row.market, row.outcomeKey, row.line, row.odds, capturedAt).changes
      }
    }
    ledger.prepare(`
      INSERT INTO ledger_state (key, value) VALUES ('last_tsl_import', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run(capturedAt)
  })()
  return { fixtures: fixtures.length, snapshots, unlinked, pending }
}

export const applyStatshubResults = (ledger: Sqlite, matches: StatshubMatch[], mainSqlite: Sqlite | null) => {
  ensureCompetitorMap(ledger)
  const findFixture = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?')
  const update = ledger.prepare(`
    UPDATE fixtures SET
      away_uid = @awayUid,
      home_uid = @homeUid,
      away_player_id = @awayPlayerId,
      home_player_id = @homePlayerId,
      away_match_status = @awayMatchStatus,
      home_match_status = @homeMatchStatus,
      away_suggested_id = @awaySuggestedId,
      home_suggested_id = @homeSuggestedId,
      status = @status,
      score = @score,
      updated_at = @updatedAt
    WHERE sportradar_id = @sportradarId
  `)
  const updatedAt = new Date().toISOString()
  const knownCache = new Map<Discipline, ReturnType<typeof loadKnownIds>>()
  const knownFor = (discipline: Discipline) => {
    const cached = knownCache.get(discipline)
    if (cached) return cached
    const known = loadKnownIds(mainSqlite, discipline)
    knownCache.set(discipline, known)
    return known
  }
  let updated = 0
  ledger.transaction(() => {
    for (const match of matches) {
      const fixture = findFixture.get(match.sportradarId) as FixtureRow | undefined
      if (!fixture) continue
      const sport = getSportForDiscipline(fixture.discipline)
      const known = knownFor(fixture.discipline)
      const away = resolveCompetitorSide(ledger, known, {
        sport,
        discipline: fixture.discipline,
        tslEventId: fixture.tsl_event_id,
        side: 'away',
        sportradarUid: match.away.uid,
        names: [fixture.away_name, match.away.name],
        existingPlayerId: fixture.away_player_id,
        existingStatus: fixture.away_match_status,
      })
      const home = resolveCompetitorSide(ledger, known, {
        sport,
        discipline: fixture.discipline,
        tslEventId: fixture.tsl_event_id,
        side: 'home',
        sportradarUid: match.home.uid,
        names: [fixture.home_name, match.home.name],
        existingPlayerId: fixture.home_player_id,
        existingStatus: fixture.home_match_status,
      })
      update.run({
        sportradarId: match.sportradarId,
        awayUid: match.away.uid,
        homeUid: match.home.uid,
        awayPlayerId: away.playerId,
        homePlayerId: home.playerId,
        awayMatchStatus: away.status,
        homeMatchStatus: home.status,
        awaySuggestedId: away.suggestedId,
        homeSuggestedId: home.suggestedId,
        status: match.status === 'abandoned' ? 'void' : match.status,
        score: formatGameScores(match.games.map(game => ({ away: game.away, home: game.home }))),
        updatedAt,
      })
      updated += 1
    }
  })()
  return updated
}

export const confirmFixtureCompetitor = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  input: {
    sportradarId: number
    side: CompetitorSide
    playerId: string
  },
) => {
  const fixture = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?').get(input.sportradarId) as FixtureRow | undefined
  if (!fixture) return null
  const sport = getSportForDiscipline(fixture.discipline)
  const known = loadKnownIds(mainSqlite, fixture.discipline)
  if (!known.byId.has(input.playerId)) return null
  const uid = input.side === 'away' ? fixture.away_uid : fixture.home_uid
  const displayName = input.side === 'away' ? fixture.away_name : fixture.home_name
  confirmCompetitorSide(ledger, {
    sport,
    discipline: fixture.discipline,
    tslEventId: fixture.tsl_event_id,
    side: input.side,
    playerId: input.playerId,
    sportradarUid: uid,
    displayName,
  })
  const playerColumn = input.side === 'away' ? 'away_player_id' : 'home_player_id'
  const statusColumn = input.side === 'away' ? 'away_match_status' : 'home_match_status'
  const suggestedColumn = input.side === 'away' ? 'away_suggested_id' : 'home_suggested_id'
  ledger.prepare(`
    UPDATE fixtures
    SET ${playerColumn} = ?, ${statusColumn} = 'confirmed', ${suggestedColumn} = ?, updated_at = ?
    WHERE sportradar_id = ?
  `).run(input.playerId, input.playerId, new Date().toISOString(), input.sportradarId)
  return fixture
}

export const unsettledFixtureDates = (ledger: Sqlite, today: string) => {
  const rows = ledger.prepare(`
    SELECT DISTINCT play_date FROM fixtures
    WHERE status IN ('pre', 'live') AND play_date <= ? AND play_date >= date(?, '-7 day')
    ORDER BY play_date
  `).all(today, today) as Array<{ play_date: string }>
  return rows.map(row => row.play_date)
}

type BetRow = {
  id: string
  fixture_id: number | null
  sport: Sport | null
  discipline: Discipline
  away_name: string
  home_name: string
  starts_at: string | null
  market: BetMarket
  outcome_key: string
  outcome_label: string
  line: number | null
  odds: number
  stake: number
  placed_at: string
  model_version: string | null
  probability: number | null
  ev: number | null
  action: BetAction | null
  status: BetStatus
  payout: number | null
  closing_odds: number | null
  closing_market: number | null
  settled_at: string | null
  note: string
}

const toBet = (row: BetRow): BetRecord => {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    sport: row.sport ?? getSportForDiscipline(row.discipline),
    discipline: row.discipline,
    awayName: row.away_name,
    homeName: row.home_name,
    startsAt: row.starts_at,
    market: row.market,
    outcomeKey: row.outcome_key,
    outcomeLabel: row.outcome_label,
    line: row.line,
    odds: row.odds,
    stake: row.stake,
    placedAt: row.placed_at,
    modelVersion: row.model_version,
    probability: row.probability,
    ev: row.ev,
    action: row.action,
    status: row.status,
    payout: row.payout,
    closingOdds: row.closing_odds,
    closingMarket: row.closing_market,
    clv: closingLineValue(row.odds, row.closing_odds),
    settledAt: row.settled_at,
    note: row.note,
  }
}

export const listBets = (ledger: Sqlite) =>
  (ledger.prepare('SELECT * FROM bets ORDER BY placed_at DESC').all() as BetRow[]).map(toBet)

export const getBet = (ledger: Sqlite, id: string) => {
  const row = ledger.prepare('SELECT * FROM bets WHERE id = ?').get(id) as BetRow | undefined
  return row ? toBet(row) : null
}

export const insertBet = (ledger: Sqlite, input: NewBetInput) => {
  const id = randomUUID()
  const sport = input.sport ?? getSportForDiscipline(input.discipline)
  ledger.prepare(`
    INSERT INTO bets (
      id, fixture_id, sport, discipline, away_name, home_name, starts_at, market, outcome_key, outcome_label,
      line, odds, stake, placed_at, model_version, probability, ev, action, note
    ) VALUES (
      @id, @fixtureId, @sport, @discipline, @awayName, @homeName, @startsAt, @market, @outcomeKey, @outcomeLabel,
      @line, @odds, @stake, @placedAt, @modelVersion, @probability, @ev, @action, @note
    )
  `).run({ ...input, id, sport, note: input.note ?? '', placedAt: new Date().toISOString() })
  if (input.fixtureId !== null) {
    markPredictionPlaced(ledger, {
      fixtureId: input.fixtureId,
      market: input.market,
      outcomeKey: input.outcomeKey,
      betId: id,
    })
  }
  return getBet(ledger, id)!
}

export const setBetStatus = (ledger: Sqlite, id: string, status: BetStatus) => {
  const bet = getBet(ledger, id)
  if (!bet) return null
  ledger.prepare('UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ?').run(
    status,
    betPayout(status, bet.stake, bet.odds),
    status === 'open' ? null : new Date().toISOString(),
    id,
  )
  return getBet(ledger, id)
}

export const updateBetNote = (ledger: Sqlite, id: string, note: string) => {
  ledger.prepare('UPDATE bets SET note = ? WHERE id = ?').run(note, id)
  return getBet(ledger, id)
}

export const deleteBet = (ledger: Sqlite, id: string) =>
  ledger.prepare('DELETE FROM bets WHERE id = ?').run(id).changes > 0

const marketSnapshots = (ledger: Sqlite, fixtureId: number, market: BetMarket): OddsSnapshot[] =>
  (ledger.prepare(`
    SELECT outcome_key, line, odds, captured_at FROM odds_snapshots
    WHERE fixture_id = ? AND market = ?
    ORDER BY captured_at, outcome_key
  `).all(fixtureId, market) as Array<{ outcome_key: string, line: number | null, odds: number, captured_at: string }>)
    .map(row => ({ outcomeKey: row.outcome_key, line: row.line, odds: row.odds, capturedAt: row.captured_at }))

export const settleOpenBets = (ledger: Sqlite) => {
  const openBets = ledger.prepare(`
    SELECT b.*, f.status AS fixture_status, f.score AS fixture_score, f.starts_at AS fixture_starts_at
    FROM bets b
    JOIN fixtures f ON f.sportradar_id = b.fixture_id
    WHERE b.status = 'open' AND f.status IN ('ended', 'void')
  `).all() as Array<BetRow & { fixture_status: FixtureStatus, fixture_score: string, fixture_starts_at: string }>
  const update = ledger.prepare(`
    UPDATE bets SET status = ?, payout = ?, closing_odds = ?, closing_market = ?, settled_at = ?
    WHERE id = ?
  `)
  const settledAt = new Date().toISOString()
  ledger.transaction(() => {
    for (const row of openBets) {
      const status = row.fixture_status === 'void'
        ? 'void'
        : settleBet(
          { market: row.market, outcomeKey: row.outcome_key, line: row.line },
          parseGameScores(row.fixture_score),
          row.sport ?? getSportForDiscipline(row.discipline),
        )
      const closing = closingOdds(
        marketSnapshots(ledger, row.fixture_id!, row.market),
        { outcomeKey: row.outcome_key, line: row.line },
        row.fixture_starts_at,
      )
      update.run(status, betPayout(status, row.stake, row.odds), closing?.odds ?? null, closing?.market ?? null, settledAt, row.id)
    }
  })()
  return openBets.length
}

const emptyOdds = (): FixtureOdds => ({
  match: null,
  set1: null,
  totals: null,
  handicap: null,
  correctScore: null,
  setHandicap: null,
  set1Totals: null,
  set1Handicap: null,
})

type SnapshotRow = { market: BetMarket, outcome_key: string, line: number | null, odds: number }

const oddsFromSnapshots = (rows: SnapshotRow[]): FixtureOdds => {
  const odds = emptyOdds()
  const pick = (market: BetMarket, key: string) => rows.find(row => row.market === market && row.outcome_key === key)
  const pair = (market: 'match' | 'set1') => {
    const away = pick(market, 'away')
    const home = pick(market, 'home')
    return away && home ? { away: away.odds, home: home.odds } : null
  }
  odds.match = pair('match')
  odds.set1 = pair('set1')
  const over = pick('totals', 'over')
  const under = pick('totals', 'under')
  if (over && under && over.line !== null) odds.totals = { line: over.line, over: over.odds, under: under.odds }
  const handicapAway = pick('handicap', 'away')
  const handicapHome = pick('handicap', 'home')
  if (handicapAway && handicapHome && handicapAway.line !== null) {
    odds.handicap = { homeLine: -handicapAway.line, away: handicapAway.odds, home: handicapHome.odds }
  }
  const scores = CORRECT_SCORES.map(score => pick('correctScore', score))
  if (scores.every(Boolean)) {
    odds.correctScore = Object.fromEntries(CORRECT_SCORES.map((score, index) => [score, scores[index]!.odds])) as Record<CorrectScore, number>
  }
  const setHandicapAway = pick('setHandicap', 'away')
  const setHandicapHome = pick('setHandicap', 'home')
  if (setHandicapAway && setHandicapHome && setHandicapAway.line !== null) {
    odds.setHandicap = { homeLine: -setHandicapAway.line, away: setHandicapAway.odds, home: setHandicapHome.odds }
  }
  const set1Over = pick('set1Totals', 'over')
  const set1Under = pick('set1Totals', 'under')
  if (set1Over && set1Under && set1Over.line !== null) {
    odds.set1Totals = { line: set1Over.line, over: set1Over.odds, under: set1Under.odds }
  }
  const set1HandicapAway = pick('set1Handicap', 'away')
  const set1HandicapHome = pick('set1Handicap', 'home')
  if (set1HandicapAway && set1HandicapHome && set1HandicapAway.line !== null) {
    odds.set1Handicap = { homeLine: -set1HandicapAway.line, away: set1HandicapAway.odds, home: set1HandicapHome.odds }
  }
  return odds
}

type RatingRow = {
  player_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
}

const COUNT_COLUMNS = ['set1_count', 'game1_count'] as const

const prepareRatingLookup = (
  sqlite: Sqlite,
  ratingsTable: 'player_ratings' | 'volleyball_team_ratings',
  playersTable: 'players' | 'volleyball_teams',
  idColumn: 'player_id' | 'team_id',
) => {
  if (!sqliteTableExists(sqlite, ratingsTable) || !sqliteTableExists(sqlite, playersTable)) return null
  const countColumn = existingColumn(sqlite, ratingsTable, COUNT_COLUMNS)
  const countSql = countColumn ? `r."${countColumn}"` : '0'
  const extra = ratingsTable === 'volleyball_team_ratings'
    ? ', r.home_advantage, r.roster_strength'
    : ''
  try {
    return sqlite.prepare(`
      SELECT r."${idColumn}" AS player_id, p.name_primary, r.elo, r.match_count, ${countSql} AS set1_count, r.last_played_on
        ${extra}
      FROM ${ratingsTable} r
      JOIN ${playersTable} p ON p."${idColumn}" = r."${idColumn}"
      WHERE r.discipline = ? AND r."${idColumn}" = ?
    `)
  } catch {
    return null
  }
}

const toParticipant = (row: RatingRow & { home_advantage?: number, roster_strength?: number } | undefined): Participant | null => {
  if (!row) return null
  const base: PlayerOption = {
    id: row.player_id,
    name: row.name_primary,
    elo: row.elo,
    matchCount: row.match_count,
    set1Count: row.set1_count,
    lastPlayedOn: row.last_played_on,
  }
  if (row.home_advantage !== undefined && row.roster_strength !== undefined) {
    return { ...base, homeAdvantage: row.home_advantage, rosterStrength: row.roster_strength }
  }
  return base
}

const createPlayerOptionReader = (mainSqlite: Sqlite | null) => {
  const ratingRow = mainSqlite ? prepareRatingLookup(mainSqlite, 'player_ratings', 'players', 'player_id') : null
  const volleyballRatingRow = mainSqlite
    ? prepareRatingLookup(mainSqlite, 'volleyball_team_ratings', 'volleyball_teams', 'team_id')
    : null
  return (discipline: Discipline, playerId: string | null): Participant | null => {
    if (!playerId) return null
    if ((discipline === 'M' || discipline === 'W') && volleyballRatingRow) {
      return toParticipant(volleyballRatingRow.get(discipline, playerId) as RatingRow & {
        home_advantage: number
        roster_strength: number
      } | undefined)
    }
    if (!ratingRow) return null
    return toParticipant(ratingRow.get(discipline, playerId) as RatingRow | undefined)
  }
}

export const listFixtures = (ledger: Sqlite, mainSqlite: Sqlite | null, date: string): FixtureSummary[] => {
  const fixtures = ledger.prepare('SELECT * FROM fixtures WHERE play_date = ? ORDER BY starts_at, sportradar_id').all(date) as FixtureRow[]
  const latestCapture = ledger.prepare('SELECT MAX(captured_at) AS captured_at FROM odds_snapshots WHERE fixture_id = ?')
  const snapshotRows = ledger.prepare('SELECT market, outcome_key, line, odds FROM odds_snapshots WHERE fixture_id = ? AND captured_at = ?')
  const playerOption = createPlayerOptionReader(mainSqlite)
  return fixtures.map((fixture) => {
    const { captured_at: capturedAt } = latestCapture.get(fixture.sportradar_id) as { captured_at: string | null }
    const rows = capturedAt ? snapshotRows.all(fixture.sportradar_id, capturedAt) as SnapshotRow[] : []
    const sport = fixture.discipline === 'MS' || fixture.discipline === 'WS'
      ? 'badminton' as const
      : 'volleyball' as const
    const awayMatchStatus = fixture.away_match_status === 'confirmed' ? 'confirmed' : 'pending'
    const homeMatchStatus = fixture.home_match_status === 'confirmed' ? 'confirmed' : 'pending'
    const awayConfirmed = awayMatchStatus === 'confirmed' ? playerOption(fixture.discipline, fixture.away_player_id) : null
    const homeConfirmed = homeMatchStatus === 'confirmed' ? playerOption(fixture.discipline, fixture.home_player_id) : null
    return {
      sport,
      sportradarId: fixture.sportradar_id,
      tslEventId: fixture.tsl_event_id,
      discipline: fixture.discipline,
      tournament: fixture.tournament,
      startsAt: fixture.starts_at,
      status: fixture.status,
      score: fixture.score,
      awayName: fixture.away_name,
      homeName: fixture.home_name,
      awayNameZh: fixture.away_name_zh,
      homeNameZh: fixture.home_name_zh,
      awayUid: fixture.away_uid,
      homeUid: fixture.home_uid,
      away: awayConfirmed,
      home: homeConfirmed,
      awaySuggested: playerOption(fixture.discipline, fixture.away_suggested_id),
      homeSuggested: playerOption(fixture.discipline, fixture.home_suggested_id),
      awayMatchStatus,
      homeMatchStatus,
      odds: oddsFromSnapshots(rows),
      oddsCapturedAt: capturedAt,
    }
  })
}

export const getFixtureSummary = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  sportradarId: number,
): FixtureSummary | null => {
  const row = ledger.prepare('SELECT play_date FROM fixtures WHERE sportradar_id = ?').get(sportradarId) as { play_date: string } | undefined
  if (!row) return null
  return listFixtures(ledger, mainSqlite, row.play_date).find(fixture => fixture.sportradarId === sportradarId) ?? null
}

export const lastTslImport = (ledger: Sqlite) => {
  const row = ledger.prepare("SELECT value FROM ledger_state WHERE key = 'last_tsl_import'").get() as { value: string } | undefined
  return row?.value ?? null
}

export const lastTslImportSummary = (ledger: Sqlite): TslImportSummary | null => {
  const row = ledger.prepare("SELECT value FROM ledger_state WHERE key = 'last_tsl_import_summary'").get() as { value: string } | undefined
  if (!row?.value) return null
  try {
    const parsed = JSON.parse(row.value) as TslImportSummary
    return parsed && typeof parsed.received === 'number' ? parsed : null
  } catch {
    return null
  }
}

export const saveTslImportSummary = (ledger: Sqlite, summary: TslImportSummary) => {
  ledger.prepare(`
    INSERT INTO ledger_state (key, value) VALUES ('last_tsl_import_summary', ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(summary))
}

export const listFixturesForTaipeiDay = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  date: string,
): FixtureSummary[] => {
  const dates = [...new Set([addCalendarDays(date, -1), date, addCalendarDays(date, 1)])]
  const seen = new Set<number>()
  const fixtures: FixtureSummary[] = []
  for (const playDate of dates) {
    for (const fixture of listFixtures(ledger, mainSqlite, playDate)) {
      if (seen.has(fixture.sportradarId) || !belongsOnTaipeiListingDay(fixture.startsAt, date)) continue
      seen.add(fixture.sportradarId)
      fixtures.push(fixture)
    }
  }
  return fixtures.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.sportradarId - right.sportradarId)
}

const fixturesErrorMessage = (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error)
  if (reason.includes('no such column') || reason.includes('no such table')) {
    return '本機資料庫欄位與目前版本不一致。請重啟開發伺服器；若仍失敗，再執行 npm run update:data（排球／網球表會保留）。'
  }
  return '今日對局讀取失敗，請稍後再試或重新匯入運彩賠率。'
}

export const emptyFixturesResponse = (message: string | null = null): FixturesResponse => ({
  date: taipeiDate(new Date()),
  lastImportAt: null,
  lastImportSummary: null,
  fixtures: [],
  message,
})

export const readTodayFixtures = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  match: (fixture: FixtureSummary) => boolean,
  now = new Date(),
): FixturesResponse => {
  const date = taipeiDate(now)
  try {
    const lastImportSummary = lastTslImportSummary(ledger)
    const allToday = listFixturesForTaipeiDay(ledger, mainSqlite, date)
    const fixtures = allToday.filter(match)
    return {
      date,
      lastImportAt: lastTslImport(ledger),
      lastImportSummary,
      fixtures,
      message: fixtures.length === 0 && allToday.length === 0
        ? emptyTodayMessage(lastImportSummary, date)
        : null,
    }
  } catch (error) {
    return {
      date,
      lastImportAt: null,
      lastImportSummary: null,
      fixtures: [],
      message: fixturesErrorMessage(error),
    }
  }
}

const emptyTodayMessage = (summary: TslImportSummary | null, date: string) => {
  if (!summary) return null
  if (summary.received === 0) {
    return `上次同步沒有從運彩頁收到任何場次（台北 ${date}）。請到投注頁 daily-coupons 重新執行已更新的書籤，並允許彈出視窗。`
  }
  if (summary.imported === 0 && summary.skipped.length > 0) {
    const skipped = summary.skipped.slice(0, 8).map(item => `${item.name}（${item.reason}）`).join('、')
    return `上次同步收到 ${summary.received} 場，匯入 0 場。略過：${skipped}`
  }
  if (summary.imported > 0) {
    return `上次同步收到 ${summary.received} 場、匯入 ${summary.imported} 場，但沒有台北 ${date} 可顯示的對局（略過 ${summary.skipped.length} 場）。`
  }
  return `上次同步收到 ${summary.received} 場、匯入 ${summary.imported} 場、略過 ${summary.skipped.length} 場。`
}
