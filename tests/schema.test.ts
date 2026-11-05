import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import { migrateLegacyColumns } from '../server/db/migrate'
import { openDatabase } from '../server/db/open'

describe('羽球 schema 相容', () => {
  it('把舊的 game1 欄位改成 set1，並補上 sport', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE matches (
        match_id TEXT PRIMARY KEY,
        include_match INTEGER NOT NULL,
        include_game1 INTEGER NOT NULL
      );
      CREATE TABLE player_ratings (
        discipline TEXT NOT NULL,
        player_id TEXT NOT NULL,
        elo REAL NOT NULL,
        match_count INTEGER NOT NULL,
        game1_count INTEGER NOT NULL,
        last_played_on TEXT,
        game1_recent TEXT NOT NULL
      );
      CREATE TABLE model_state (
        discipline TEXT NOT NULL PRIMARY KEY,
        model_version TEXT NOT NULL,
        game1_method TEXT NOT NULL,
        payload TEXT NOT NULL,
        data_through TEXT NOT NULL
      );
    `)
    sqlite.prepare(`
      INSERT INTO player_ratings (discipline, player_id, elo, match_count, game1_count, last_played_on, game1_recent)
      VALUES ('MS', 'p1', 1500, 10, 8, '2026-01-01', '[]')
    `).run()
    sqlite.prepare(`
      INSERT INTO model_state (discipline, model_version, game1_method, payload, data_through)
      VALUES ('MS', 'v1', 'logistic', '{}', '2026-01-01')
    `).run()

    migrateLegacyColumns(sqlite)

    const ratingColumns = (sqlite.prepare('PRAGMA table_info(player_ratings)').all() as Array<{ name: string }>).map(column => column.name)
    const modelColumns = (sqlite.prepare('PRAGMA table_info(model_state)').all() as Array<{ name: string }>).map(column => column.name)
    const matchColumns = (sqlite.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>).map(column => column.name)

    expect(ratingColumns).toContain('set1_count')
    expect(ratingColumns).toContain('set1_recent')
    expect(ratingColumns).not.toContain('game1_count')
    expect(modelColumns).toContain('set1_method')
    expect(modelColumns).toContain('sport')
    expect(modelColumns).not.toContain('game1_method')
    expect(matchColumns).toContain('include_set1')
    expect(matchColumns).not.toContain('include_game1')

    const rating = sqlite.prepare('SELECT set1_count FROM player_ratings WHERE player_id = ?').get('p1') as { set1_count: number }
    const model = sqlite.prepare('SELECT set1_method, sport FROM model_state WHERE discipline = ?').get('MS') as { set1_method: string, sport: string }
    expect(rating.set1_count).toBe(8)
    expect(model.set1_method).toBe('logistic')
    expect(model.sport).toBe('badminton')
    sqlite.close()
  })

  it('對已經是 set1 的資料庫再跑一次不會炸掉', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-schema-'))
    const file = join(dir, 'app.sqlite')
    const first = openDatabase(file)
    first.sqlite.exec(`
      INSERT INTO volleyball_matches (match_id, discipline, tournament, played_on, side_a_id, side_b_id, include_match)
      VALUES ('m1', 'M', 'VNL', '2026-01-01', 'a', 'b', 1)
    `)
    first.sqlite.close()
    const second = openDatabase(file)
    const volleyballColumns = (second.sqlite.prepare('PRAGMA table_info(volleyball_matches)').all() as Array<{ name: string }>).map(column => column.name)
    expect(volleyballColumns).toContain('side_a_won_match')
    const tables = second.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_sets'`).get()
    expect(tables).toBeTruthy()
    second.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('遷移會建立網球表、刪掉未使用的隊伍表，並補齊排球欄位', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-drop-'))
    const file = join(dir, 'app.sqlite')
    const first = openDatabase(file)
    first.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS teams (team_id TEXT PRIMARY KEY, name_primary TEXT);
      INSERT INTO volleyball_matches (match_id, discipline, tournament, played_on, side_a_id, side_b_id, include_match)
      VALUES ('v1', 'M', 'VNL', '2026-01-01', 'a', 'b', 1);
    `)
    first.sqlite.close()
    const second = openDatabase(file)
    const tables = (second.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map(row => row.name)
    expect(tables).toContain('tennis_players')
    expect(tables).toContain('tennis_matches')
    expect(tables).toContain('tennis_sets')
    expect(tables).toContain('tennis_player_ratings')
    expect(tables).toContain('tennis_model_state')
    expect(tables).not.toContain('teams')
    const volleyballColumns = (second.sqlite.prepare('PRAGMA table_info(volleyball_matches)').all() as Array<{ name: string }>).map(column => column.name)
    expect(volleyballColumns).toContain('include_set1')
    expect(volleyballColumns).toContain('source_url')
    second.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('帳本 schema', () => {
  it('舊的覆盤 prediction_snapshots 會搬到 review_snapshots，並重建 JSON 快照表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-ledger-review-'))
    const file = join(dir, 'ledger.sqlite')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE prediction_snapshots (
        id TEXT PRIMARY KEY,
        fixture_id INTEGER NOT NULL,
        predicted_at TEXT NOT NULL,
        sport TEXT NOT NULL,
        discipline TEXT NOT NULL,
        tournament TEXT NOT NULL,
        market TEXT NOT NULL,
        outcome_key TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        line REAL,
        model_raw REAL,
        qualitative_adjusted REAL,
        market_vig_removed REAL,
        odds REAL,
        odds_captured_at TEXT,
        decision_action TEXT,
        data_sufficient INTEGER NOT NULL DEFAULT 0,
        model_version TEXT,
        sample_away INTEGER,
        sample_home INTEGER,
        bet_id TEXT,
        parlay_id TEXT,
        placed INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO prediction_snapshots (
        id, fixture_id, predicted_at, sport, discipline, tournament, market, outcome_key, outcome_label, placed
      ) VALUES ('snap-1', 101, '2026-10-22T08:00:00.000Z', 'badminton', 'MS', 'Test', 'match', 'away', '客勝', 0);
    `)
    raw.close()
    const ledger = openLedger(file)
    const predictionColumns = (ledger.prepare('PRAGMA table_info(prediction_snapshots)').all() as Array<{ name: string }>).map(column => column.name)
    const moved = ledger.prepare('SELECT id FROM review_snapshots WHERE id = ?').get('snap-1') as { id: string } | undefined
    expect(predictionColumns).toContain('created_at')
    expect(predictionColumns).toContain('response_json')
    expect(predictionColumns).not.toContain('predicted_at')
    expect(moved?.id).toBe('snap-1')
    ledger.prepare(`
      INSERT INTO prediction_snapshots (id, fixture_id, created_at, response_json, request_json)
      VALUES ('quote-1', 101, '2026-10-22T08:01:00.000Z', '{}', '{}')
    `).run()
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('舊 bets 表沒有 ticket_id 時仍能開啟並補欄', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-ledger-'))
    const file = join(dir, 'ledger.sqlite')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE fixtures (
        sportradar_id INTEGER PRIMARY KEY,
        tsl_event_id TEXT NOT NULL,
        discipline TEXT NOT NULL,
        tournament TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        play_date TEXT NOT NULL,
        away_name TEXT NOT NULL,
        home_name TEXT NOT NULL,
        away_name_zh TEXT NOT NULL DEFAULT '',
        home_name_zh TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pre',
        score TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE bets (
        id TEXT PRIMARY KEY,
        fixture_id INTEGER,
        sport TEXT,
        discipline TEXT NOT NULL,
        away_name TEXT NOT NULL,
        home_name TEXT NOT NULL,
        starts_at TEXT,
        market TEXT NOT NULL,
        outcome_key TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        line REAL,
        odds REAL NOT NULL,
        stake REAL NOT NULL,
        placed_at TEXT NOT NULL,
        model_version TEXT,
        probability REAL,
        ev REAL,
        action TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        payout REAL,
        closing_odds REAL,
        closing_market REAL,
        settled_at TEXT,
        note TEXT NOT NULL DEFAULT ''
      );
    `)
    raw.close()
    const ledger = openLedger(file)
    const betColumns = (ledger.prepare('PRAGMA table_info(bets)').all() as Array<{ name: string }>).map(column => column.name)
    const fixtureColumns = (ledger.prepare('PRAGMA table_info(fixtures)').all() as Array<{ name: string }>).map(column => column.name)
    expect(betColumns).toContain('ticket_id')
    expect(fixtureColumns).toContain('sport')
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
