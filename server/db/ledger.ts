import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

const LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS fixtures (
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
  away_uid INTEGER,
  home_uid INTEGER,
  away_player_id TEXT,
  home_player_id TEXT,
  status TEXT NOT NULL DEFAULT 'pre',
  score TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  fixture_id INTEGER NOT NULL,
  market TEXT NOT NULL,
  outcome_key TEXT NOT NULL,
  line REAL,
  odds REAL NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (fixture_id, market, outcome_key, captured_at),
  FOREIGN KEY (fixture_id) REFERENCES fixtures(sportradar_id)
);

CREATE TABLE IF NOT EXISTS bets (
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

CREATE TABLE IF NOT EXISTS ledger_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fixtures_play_date ON fixtures (play_date);
CREATE INDEX IF NOT EXISTS odds_fixture_time ON odds_snapshots (fixture_id, captured_at);
CREATE INDEX IF NOT EXISTS bets_status ON bets (status);
`

export const openLedger = (file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.exec(LEDGER_SQL)
  const betColumns = sqlite.prepare(`PRAGMA table_info(bets)`).all() as Array<{ name: string }>
  if (!betColumns.some(column => column.name === 'sport')) {
    sqlite.exec(`ALTER TABLE bets ADD COLUMN sport TEXT`)
  }
  return sqlite
}

export type LedgerDatabase = ReturnType<typeof openLedger>
