import type Database from 'better-sqlite3'

type Sqlite = Database.Database
type ColumnInfo = { name: string }

export const tableExists = (sqlite: Sqlite, table: string) =>
  Boolean(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table))

export const columnNames = (sqlite: Sqlite, table: string) =>
  new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]).map(column => column.name))

export const existingColumn = (sqlite: Sqlite, table: string, candidates: readonly string[]) => {
  if (!tableExists(sqlite, table)) return null
  const names = columnNames(sqlite, table)
  return candidates.find(name => names.has(name)) ?? null
}
