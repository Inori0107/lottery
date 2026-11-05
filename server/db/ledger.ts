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

CREATE TABLE IF NOT EXISTS competitor_map (
  sport TEXT NOT NULL,
  discipline TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sport, discipline, source, source_id)
);

CREATE TABLE IF NOT EXISTS parlays (
  id TEXT PRIMARY KEY,
  stake REAL NOT NULL,
  combined_odds REAL NOT NULL,
  combined_ev REAL,
  status TEXT NOT NULL DEFAULT 'open',
  payout REAL,
  placed_at TEXT NOT NULL,
  settled_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS parlay_legs (
  parlay_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  fixture_id INTEGER,
  sport TEXT,
  discipline TEXT,
  tournament TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL DEFAULT '',
  away_name TEXT NOT NULL,
  home_name TEXT NOT NULL,
  market TEXT NOT NULL,
  outcome_key TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  line REAL,
  odds REAL NOT NULL,
  probability REAL,
  probability_source TEXT NOT NULL,
  data_sufficient INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (parlay_id, position),
  FOREIGN KEY (parlay_id) REFERENCES parlays(id)
);

CREATE INDEX IF NOT EXISTS fixtures_play_date ON fixtures (play_date);
CREATE INDEX IF NOT EXISTS fixtures_tsl_event ON fixtures (tsl_event_id);
CREATE INDEX IF NOT EXISTS odds_fixture_time ON odds_snapshots (fixture_id, captured_at);
CREATE INDEX IF NOT EXISTS bets_status ON bets (status);
CREATE TABLE IF NOT EXISTS probability_adjustments (
  id TEXT PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  market TEXT NOT NULL,
  outcome_key TEXT NOT NULL,
  delta_pct REAL NOT NULL,
  reason_category TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
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

CREATE INDEX IF NOT EXISTS parlay_legs_parlay ON parlay_legs (parlay_id);
CREATE INDEX IF NOT EXISTS adjustments_fixture ON probability_adjustments (fixture_id, created_at);
CREATE INDEX IF NOT EXISTS predictions_fixture_time ON prediction_snapshots (fixture_id, predicted_at);
CREATE INDEX IF NOT EXISTS predictions_filters ON prediction_snapshots (sport, market, decision_action, predicted_at);
`

const addColumnIfMissing = (sqlite: InstanceType<typeof Database>, table: string, column: string, definition: string) => {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export const openLedger = (file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.exec(LEDGER_SQL)
  addColumnIfMissing(sqlite, 'bets', 'sport', 'TEXT')
  addColumnIfMissing(sqlite, 'fixtures', 'away_match_status', "TEXT NOT NULL DEFAULT 'pending'")
  addColumnIfMissing(sqlite, 'fixtures', 'home_match_status', "TEXT NOT NULL DEFAULT 'pending'")
  addColumnIfMissing(sqlite, 'fixtures', 'away_suggested_id', 'TEXT')
  addColumnIfMissing(sqlite, 'fixtures', 'home_suggested_id', 'TEXT')
  return sqlite
}

export type LedgerDatabase = ReturnType<typeof openLedger>
