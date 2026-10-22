import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { migrateLegacyColumns } from './migrate'
import { SCHEMA_SQL } from './sql'

export const openDatabase = (file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.exec(SCHEMA_SQL)
  migrateLegacyColumns(sqlite)
  return { sqlite }
}

export type AppDatabase = ReturnType<typeof openDatabase>
