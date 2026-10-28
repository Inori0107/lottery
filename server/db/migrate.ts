import Database from 'better-sqlite3'
import { columnNames, tableExists } from './columns'

type Sqlite = InstanceType<typeof Database>

const renameColumnIfNeeded = (sqlite: Sqlite, table: string, from: string, to: string) => {
  if (!tableExists(sqlite, table)) return
  const names = columnNames(sqlite, table)
  if (names.has(from) && !names.has(to)) {
    sqlite.exec(`ALTER TABLE ${table} RENAME COLUMN "${from}" TO "${to}"`)
  }
}

const addColumnIfNeeded = (sqlite: Sqlite, table: string, definition: string) => {
  if (!tableExists(sqlite, table)) return
  const name = definition.trim().split(/\s+/)[0]
  if (!name) return
  if (!columnNames(sqlite, table).has(name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

const DROPPED_TABLES = [
  'team_ratings',
  'teams',
] as const

export const migrateLegacyColumns = (sqlite: Sqlite) => {
  renameColumnIfNeeded(sqlite, 'matches', 'include_game1', 'include_set1')
  renameColumnIfNeeded(sqlite, 'player_ratings', 'game1_count', 'set1_count')
  renameColumnIfNeeded(sqlite, 'player_ratings', 'game1_recent', 'set1_recent')
  renameColumnIfNeeded(sqlite, 'model_state', 'game1_method', 'set1_method')
  addColumnIfNeeded(sqlite, 'model_state', `sport TEXT NOT NULL DEFAULT 'badminton'`)
  addColumnIfNeeded(sqlite, 'matches', `sport TEXT NOT NULL DEFAULT 'badminton'`)
  addColumnIfNeeded(sqlite, 'events', `sport TEXT NOT NULL DEFAULT 'badminton'`)
  addColumnIfNeeded(sqlite, 'volleyball_matches', 'side_a_won_match INTEGER')
  addColumnIfNeeded(sqlite, 'volleyball_matches', 'include_set1 INTEGER NOT NULL DEFAULT 0')
  addColumnIfNeeded(sqlite, 'volleyball_matches', `source_url TEXT NOT NULL DEFAULT ''`)
  for (const table of DROPPED_TABLES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
  }
}
