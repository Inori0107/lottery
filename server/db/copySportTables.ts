import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'

export const ISOLATED_SPORT_TABLES = [
  'tennis_players',
  'tennis_matches',
  'tennis_sets',
  'tennis_player_ratings',
  'tennis_model_state',
  'volleyball_teams',
  'volleyball_matches',
  'volleyball_sets',
  'volleyball_team_ratings',
  'volleyball_model_state',
] as const

export const copyIsolatedSportTables = (fromFile: string, toFile: string) => {
  if (!existsSync(fromFile) || !existsSync(toFile) || fromFile === toFile) return

  const from = new Database(fromFile, { readonly: true, fileMustExist: true })
  const to = new Database(toFile)
  to.pragma('busy_timeout = 5000')
  to.pragma('foreign_keys = OFF')
  const escaped = fromFile.replaceAll("'", "''")
  to.exec(`ATTACH DATABASE '${escaped}' AS src`)
  try {
    for (const table of ISOLATED_SPORT_TABLES) {
      const sourceExists = from.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
      const destExists = to.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)
      if (!sourceExists || !destExists) continue
      const fromColumns = (from.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
      const toColumns = (to.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
      const shared = fromColumns.filter(column => toColumns.includes(column))
      if (shared.length === 0) continue
      const columns = shared.map(column => `"${column}"`).join(', ')
      to.exec(`DELETE FROM "${table}"`)
      to.exec(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM src."${table}"`)
    }
  } finally {
    to.exec('DETACH DATABASE src')
    to.pragma('foreign_keys = ON')
    to.close()
    from.close()
  }
}
