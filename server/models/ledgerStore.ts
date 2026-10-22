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
  NewBetInput,
  PlayerOption,
  Sport,
} from '../../shared/types'
import { CORRECT_SCORES } from '../../shared/types'
import { getSportForDiscipline } from '../../shared/sports'
import { betPayout, closingLineValue, closingOdds, formatGameScores, parseGameScores, settleBet, type OddsSnapshot } from './settle'
import { resolveStatshubPlayer, splitStatshubName, type StatshubMatch } from './statshub'
import { buildPlayerDirectory, foldPlayerName, type PlayerDirectory } from './sun'
import { buildTennisAliasIndex, resolveTennisPlayerId } from './tennisNames'
import type { TslFixture } from './tsl'

type Sqlite = Database.Database

export const taipeiDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date)

export type PlayerLinker = (discipline: Discipline, names: string[], uid: number | null) => string | null

export const createPlayerLinker = (mainSqlite: Sqlite | null): PlayerLinker => {
  if (!mainSqlite) return () => null
  const cache = new Map<Discipline, { directory: PlayerDirectory, ids: Set<string> }>()
  const tennisIndexCache = new Map<Discipline, Map<string, string>>()
  const tableExists = (name: string) =>
    Boolean(mainSqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name))

  const load = (discipline: Discipline) => {
    const cached = cache.get(discipline)
    if (cached) return cached
    const players = mainSqlite.prepare(`
      SELECT p.player_id AS id, p.name_primary AS name
      FROM player_ratings r
      JOIN players p ON p.player_id = r.player_id
      WHERE r.discipline = ?
    `).all(discipline) as Array<{ id: string, name: string }>
    const entry = { directory: buildPlayerDirectory(players), ids: new Set(players.map(player => player.id)) }
    cache.set(discipline, entry)
    return entry
  }

  return (discipline, names, uid) => {
    if (discipline === 'ATP' || discipline === 'WTA') {
      if (!tableExists('tennis_player_ratings')) return null
      let index = tennisIndexCache.get(discipline)
      if (!index) {
        const players = mainSqlite.prepare(`
          SELECT p.player_id AS id, p.name_primary AS name
          FROM tennis_player_ratings r
          JOIN tennis_players p ON p.player_id = r.player_id
          WHERE r.discipline = ?
        `).all(discipline) as Array<{ id: string, name: string }>
        index = buildTennisAliasIndex(players)
        tennisIndexCache.set(discipline, index)
      }
      return resolveTennisPlayerId(names, index)
    }
    const { directory, ids } = load(discipline)
    return resolveStatshubPlayer(names, uid, directory, ids) ?? null
  }
}

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
  status: FixtureStatus
  score: string
}

export type ImportSummary = {
  fixtures: number
  snapshots: number
  unlinked: string[]
}

export const importTslFixtures = (
  ledger: Sqlite,
  fixtures: TslFixture[],
  link: PlayerLinker,
  capturedAt: string,
): ImportSummary => {
  const findFixture = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?')
  const upsert = ledger.prepare(`
    INSERT INTO fixtures (
      sportradar_id, tsl_event_id, discipline, tournament, starts_at, play_date,
      away_name, home_name, away_name_zh, home_name_zh, away_player_id, home_player_id, updated_at
    ) VALUES (
      @sportradarId, @tslEventId, @discipline, @tournament, @startsAt, @playDate,
      @awayName, @homeName, @awayNameZh, @homeNameZh, @awayPlayerId, @homePlayerId, @updatedAt
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
      away_player_id = COALESCE(excluded.away_player_id, fixtures.away_player_id),
      home_player_id = COALESCE(excluded.home_player_id, fixtures.home_player_id),
      updated_at = excluded.updated_at
  `)
  const insertSnapshot = ledger.prepare(`
    INSERT OR IGNORE INTO odds_snapshots (fixture_id, market, outcome_key, line, odds, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const unlinked: string[] = []
  let snapshots = 0
  ledger.transaction(() => {
    for (const fixture of fixtures) {
      const existing = findFixture.get(fixture.sportradarId) as FixtureRow | undefined
      const awayPlayerId = link(fixture.discipline, [fixture.awayName], existing?.away_uid ?? null)
      const homePlayerId = link(fixture.discipline, [fixture.homeName], existing?.home_uid ?? null)
      if (!awayPlayerId && !existing?.away_player_id) unlinked.push(fixture.awayName)
      if (!homePlayerId && !existing?.home_player_id) unlinked.push(fixture.homeName)
      upsert.run({
        ...fixture,
        playDate: taipeiDate(new Date(fixture.startsAt)),
        awayPlayerId,
        homePlayerId,
        updatedAt: capturedAt,
      })
      if (capturedAt >= fixture.startsAt) continue
      for (const row of fixture.rows) {
        snapshots += insertSnapshot.run(fixture.sportradarId, row.market, row.outcomeKey, row.line, row.odds, capturedAt).changes
      }
    }
    ledger.prepare(`
      INSERT INTO ledger_state (key, value) VALUES ('last_tsl_import', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run(capturedAt)
  })()
  return { fixtures: fixtures.length, snapshots, unlinked }
}

const surnameKey = (name: string) => foldPlayerName(splitStatshubName(name).surname)

const sameOrientation = (match: StatshubMatch, awayName: string, homeName: string) => {
  const away = surnameKey(awayName)
  const home = surnameKey(homeName)
  if (surnameKey(match.away.name) === away || surnameKey(match.home.name) === home) return true
  if (surnameKey(match.home.name) === away || surnameKey(match.away.name) === home) return false
  return true
}

export const applyStatshubResults = (ledger: Sqlite, matches: StatshubMatch[], link: PlayerLinker) => {
  const findFixture = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?')
  const update = ledger.prepare(`
    UPDATE fixtures SET
      away_uid = @awayUid,
      home_uid = @homeUid,
      away_player_id = COALESCE(away_player_id, @awayPlayerId),
      home_player_id = COALESCE(home_player_id, @homePlayerId),
      status = @status,
      score = @score,
      updated_at = @updatedAt
    WHERE sportradar_id = @sportradarId
  `)
  const updatedAt = new Date().toISOString()
  let updated = 0
  ledger.transaction(() => {
    for (const match of matches) {
      const fixture = findFixture.get(match.sportradarId) as FixtureRow | undefined
      if (!fixture) continue
      const aligned = sameOrientation(match, fixture.away_name, fixture.home_name)
      const awayTeam = aligned ? match.away : match.home
      const homeTeam = aligned ? match.home : match.away
      const games = match.games.map(game => (aligned
        ? { away: game.away, home: game.home }
        : { away: game.home, home: game.away }))
      update.run({
        sportradarId: match.sportradarId,
        awayUid: awayTeam.uid,
        homeUid: homeTeam.uid,
        awayPlayerId: link(fixture.discipline, [fixture.away_name, awayTeam.name], awayTeam.uid),
        homePlayerId: link(fixture.discipline, [fixture.home_name, homeTeam.name], homeTeam.uid),
        status: match.status === 'abandoned' ? 'void' : match.status,
        score: formatGameScores(games),
        updatedAt,
      })
      updated += 1
    }
  })()
  return updated
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
        : settleBet({ market: row.market, outcomeKey: row.outcome_key, line: row.line }, parseGameScores(row.fixture_score))
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
  game1_count: number
  last_played_on: string | null
}

const createPlayerOptionReader = (mainSqlite: Sqlite | null) => {
  const tableExists = (name: string) =>
    Boolean(mainSqlite?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name))
  const ratingRow = mainSqlite?.prepare(`
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.game1_count, r.last_played_on
    FROM player_ratings r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.discipline = ? AND r.player_id = ?
  `)
  const tennisRatingRow = mainSqlite && tableExists('tennis_player_ratings')
    ? mainSqlite.prepare(`
      SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on
      FROM tennis_player_ratings r
      JOIN tennis_players p ON p.player_id = r.player_id
      WHERE r.discipline = ? AND r.player_id = ?
    `)
    : null
  return (discipline: Discipline, playerId: string | null): PlayerOption | null => {
    if (!playerId) return null
    if ((discipline === 'ATP' || discipline === 'WTA') && tennisRatingRow) {
      const row = tennisRatingRow.get(discipline, playerId) as {
        player_id: string
        name_primary: string
        elo: number
        match_count: number
        set1_count: number
        last_played_on: string | null
      } | undefined
      if (!row) return null
      return {
        id: row.player_id,
        name: row.name_primary,
        elo: row.elo,
        matchCount: row.match_count,
        set1Count: row.set1_count,
        lastPlayedOn: row.last_played_on,
      }
    }
    if (!ratingRow) return null
    const row = ratingRow.get(discipline, playerId) as RatingRow | undefined
    if (!row) return null
    return {
      id: row.player_id,
      name: row.name_primary,
      elo: row.elo,
      matchCount: row.match_count,
      set1Count: row.game1_count,
      lastPlayedOn: row.last_played_on,
    }
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
      : fixture.discipline === 'ATP' || fixture.discipline === 'WTA'
        ? 'tennis' as const
        : 'volleyball' as const
    return {
      sport,
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
      away: playerOption(fixture.discipline, fixture.away_player_id),
      home: playerOption(fixture.discipline, fixture.home_player_id),
      odds: oddsFromSnapshots(rows),
      oddsCapturedAt: capturedAt,
    }
  })
}

export const lastTslImport = (ledger: Sqlite) => {
  const row = ledger.prepare("SELECT value FROM ledger_state WHERE key = 'last_tsl_import'").get() as { value: string } | undefined
  return row?.value ?? null
}
