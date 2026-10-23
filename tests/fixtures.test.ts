import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../server/db/open'
import { openLedger } from '../server/db/ledger'
import { listFixtures, readTodayFixtures, taipeiDate } from '../server/models/ledgerStore'

const MAIN_SCHEMA = `
CREATE TABLE players (
  player_id TEXT PRIMARY KEY,
  name_primary TEXT NOT NULL,
  name_aliases TEXT NOT NULL DEFAULT ''
);
CREATE TABLE player_ratings (
  discipline TEXT NOT NULL,
  player_id TEXT NOT NULL,
  elo REAL NOT NULL,
  match_count INTEGER NOT NULL,
  game1_count INTEGER NOT NULL,
  last_played_on TEXT,
  game1_recent TEXT NOT NULL,
  PRIMARY KEY (discipline, player_id)
);
CREATE TABLE model_state (
  discipline TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  game1_method TEXT NOT NULL,
  payload TEXT NOT NULL,
  data_through TEXT NOT NULL
);
`

const seedMainRatings = (sqlite: InstanceType<typeof Database>) => {
  sqlite.exec(`
    INSERT INTO players (player_id, name_primary) VALUES ('p-away', 'Viktor AXELSEN');
    INSERT INTO players (player_id, name_primary) VALUES ('p-home', 'Christo POPOV');
    INSERT INTO player_ratings (discipline, player_id, elo, match_count, game1_count, last_played_on, game1_recent)
    VALUES
      ('MS', 'p-away', 2400, 20, 18, '2026-10-01', '[]'),
      ('MS', 'p-home', 2100, 15, 12, '2026-10-01', '[]');
  `)
}

const seedTodayFixture = (ledger: InstanceType<typeof Database>, date: string, extra: {
  sportradarId?: number
  discipline?: string
  awayPlayerId?: string | null
  homePlayerId?: string | null
} = {}) => {
  ledger.prepare(`
    INSERT INTO fixtures (
      sportradar_id, tsl_event_id, discipline, tournament, starts_at, play_date,
      away_name, home_name, away_player_id, home_player_id, updated_at
    ) VALUES (?, 'e1', ?, 'Test Open', ?, ?, 'Away', 'Home', ?, ?, ?)
  `).run(
    extra.sportradarId ?? 101,
    extra.discipline ?? 'MS',
    `${date}T02:00:00.000Z`,
    date,
    extra.awayPlayerId ?? 'p-away',
    extra.homePlayerId ?? 'p-home',
    new Date().toISOString(),
  )
}

describe('今日對局相容舊羽球資料庫', () => {
  it('main 的 game1_count 庫在切到此分支後，listFixtures 不會因欄位名 500', () => {
    const main = new Database(':memory:')
    main.exec(MAIN_SCHEMA)
    seedMainRatings(main)
    const dir = mkdtempSync(join(tmpdir(), 'lottery-fx-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    const date = taipeiDate(new Date())
    seedTodayFixture(ledger, date)

    expect(() => listFixtures(ledger, main, date)).not.toThrow()
    const fixtures = listFixtures(ledger, main, date)
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]?.away).toMatchObject({ id: 'p-away', name: 'Viktor AXELSEN', set1Count: 18 })
    expect(fixtures[0]?.home).toMatchObject({ id: 'p-home', set1Count: 12 })

    const payload = readTodayFixtures(ledger, main, fixture => fixture.discipline === 'MS')
    expect(payload.message).toBeNull()
    expect(payload.fixtures).toHaveLength(1)

    main.close()
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('openDatabase 遷移舊庫後，三項運動的 fixtures 讀取都是空陣列而不是丟例外', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-fx-open-'))
    const dbFile = join(dir, 'badminton.sqlite')
    const raw = new Database(dbFile)
    raw.exec(MAIN_SCHEMA)
    seedMainRatings(raw)
    raw.close()

    const { sqlite } = openDatabase(dbFile)
    const columns = (sqlite.prepare('PRAGMA table_info(player_ratings)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).toContain('set1_count')
    expect(columns).not.toContain('game1_count')

    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    const date = taipeiDate(new Date())
    seedTodayFixture(ledger, date, { sportradarId: 1, discipline: 'MS' })
    seedTodayFixture(ledger, date, { sportradarId: 2, discipline: 'M', awayPlayerId: null, homePlayerId: null })
    seedTodayFixture(ledger, date, { sportradarId: 3, discipline: 'ATP', awayPlayerId: null, homePlayerId: null })

    const badminton = readTodayFixtures(ledger, sqlite, fixture => fixture.discipline === 'MS' || fixture.discipline === 'WS')
    const volleyball = readTodayFixtures(ledger, sqlite, fixture => fixture.discipline === 'M' || fixture.discipline === 'W')
    const tennis = readTodayFixtures(ledger, sqlite, fixture => fixture.discipline === 'ATP' || fixture.discipline === 'WTA')

    expect(badminton.message).toBeNull()
    expect(volleyball.message).toBeNull()
    expect(tennis.message).toBeNull()
    expect(badminton.fixtures).toHaveLength(1)
    expect(badminton.fixtures[0]?.away?.set1Count).toBe(18)
    expect(volleyball.fixtures).toHaveLength(1)
    expect(tennis.fixtures).toHaveLength(1)

    sqlite.close()
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('主資料庫或 fixtures 表缺失時回傳說明，不丟例外', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-fx-empty-'))
    const empty = new Database(':memory:')
    const brokenLedger = new Database(':memory:')
    const payload = readTodayFixtures(brokenLedger, empty, () => true)
    expect(payload.fixtures).toEqual([])
    expect(payload.message).toContain('資料庫')

    const missingRatings = new Database(':memory:')
    missingRatings.exec('CREATE TABLE players (player_id TEXT PRIMARY KEY, name_primary TEXT)')
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    const date = taipeiDate(new Date())
    seedTodayFixture(ledger, date, { awayPlayerId: null, homePlayerId: null })
    const listed = listFixtures(ledger, missingRatings, date)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.away).toBeNull()

    empty.close()
    brokenLedger.close()
    missingRatings.close()
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
