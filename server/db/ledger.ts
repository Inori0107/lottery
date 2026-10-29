import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

const LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS fixtures (
  sportradar_id INTEGER PRIMARY KEY,
  tsl_event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'badminton',
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
  ticket_id TEXT,
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

CREATE TABLE IF NOT EXISTS market_snapshots (
  fixture_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  markets_json TEXT NOT NULL,
  PRIMARY KEY (fixture_id, captured_at),
  FOREIGN KEY (fixture_id) REFERENCES fixtures(sportradar_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ledger_kind TEXT NOT NULL,
  stake REAL NOT NULL,
  combined_odds REAL NOT NULL,
  combined_probability REAL,
  ev REAL,
  status TEXT NOT NULL DEFAULT 'open',
  payout REAL,
  placed_at TEXT NOT NULL,
  settled_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bankrolls (
  kind TEXT PRIMARY KEY,
  starting REAL NOT NULL,
  balance REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY,
  fixture_id INTEGER,
  created_at TEXT NOT NULL,
  response_json TEXT NOT NULL,
  request_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS fixtures_play_date ON fixtures (play_date);
CREATE INDEX IF NOT EXISTS odds_fixture_time ON odds_snapshots (fixture_id, captured_at);
CREATE INDEX IF NOT EXISTS bets_status ON bets (status);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status);
`

const addColumnIfNeeded = (sqlite: InstanceType<typeof Database>, table: string, definition: string) => {
  const name = definition.trim().split(/\s+/)[0]
  if (!name) return
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(column => column.name === name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

export const DEFAULT_SIM_BANKROLL = 10_000

export const openLedger = (file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 30000')
  sqlite.exec(LEDGER_SQL)
  addColumnIfNeeded(sqlite, 'bets', 'sport TEXT')
  addColumnIfNeeded(sqlite, 'bets', 'ticket_id TEXT')
  addColumnIfNeeded(sqlite, 'bets', 'source_market_id TEXT')
  addColumnIfNeeded(sqlite, 'bets', 'odds_captured_at TEXT')
  addColumnIfNeeded(sqlite, 'bets', 'quote_id TEXT')
  addColumnIfNeeded(sqlite, 'bets', 'market_probability REAL')
  addColumnIfNeeded(sqlite, 'tickets', 'archived_at TEXT')
  addColumnIfNeeded(sqlite, 'tickets', "strategy TEXT NOT NULL DEFAULT 'research'")
  addColumnIfNeeded(sqlite, 'fixtures', `ignored_markets TEXT NOT NULL DEFAULT '[]'`)
  addColumnIfNeeded(sqlite, 'fixtures', `sport TEXT NOT NULL DEFAULT 'badminton'`)
  sqlite.exec('CREATE INDEX IF NOT EXISTS bets_ticket ON bets (ticket_id)')
  sqlite.exec(`UPDATE fixtures SET sport = 'volleyball' WHERE discipline IN ('M', 'W') AND (sport = 'badminton' OR sport IS NULL OR sport = '')`)
  sqlite.exec(`UPDATE fixtures SET sport = 'tennis' WHERE discipline IN ('ATP', 'WTA')`)
  sqlite.prepare(`
    INSERT OR IGNORE INTO bankrolls (kind, starting, balance) VALUES ('sim', ?, ?)
  `).run(DEFAULT_SIM_BANKROLL, DEFAULT_SIM_BANKROLL)
  sqlite.prepare(`
    INSERT OR IGNORE INTO bankrolls (kind, starting, balance) VALUES ('real', 0, 0)
  `).run()
  return sqlite
}

export type LedgerDatabase = ReturnType<typeof openLedger>
