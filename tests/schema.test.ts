import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { copyIsolatedSportTables } from '../server/db/copySportTables'
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

  it('羽球重建時會把排球與網球表複製過去', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-copy-'))
    const fromFile = join(dir, 'live.sqlite')
    const toFile = join(dir, 'next.sqlite')
    const from = openDatabase(fromFile)
    from.sqlite.exec(`
      INSERT INTO tennis_players (player_id, name_primary) VALUES ('p1', 'Player One');
      INSERT INTO tennis_matches (match_id, discipline, tournament, best_of, played_on, side_a_id, side_b_id, include_match, include_set1, source_url)
      VALUES ('t1', 'ATP', 'Beijing', 3, '2026-01-01', 'p1', 'p1', 1, 1, 'test');
      INSERT INTO volleyball_teams (team_id, name_primary) VALUES ('Italy', 'Italy');
      INSERT INTO volleyball_matches (match_id, discipline, tournament, played_on, side_a_id, side_b_id, include_match)
      VALUES ('v1', 'M', 'VNL', '2026-01-01', 'Italy', 'Italy', 1);
    `)
    from.sqlite.close()
    const to = openDatabase(toFile)
    to.sqlite.close()
    copyIsolatedSportTables(fromFile, toFile)
    const copied = openDatabase(toFile)
    const tennis = copied.sqlite.prepare('SELECT COUNT(*) AS n FROM tennis_matches').get() as { n: number }
    const volleyball = copied.sqlite.prepare('SELECT COUNT(*) AS n FROM volleyball_matches').get() as { n: number }
    expect(tennis.n).toBe(1)
    expect(volleyball.n).toBe(1)
    copied.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
