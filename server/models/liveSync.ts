import type Database from 'better-sqlite3'
import {
  applyStatshubResults,
  createPlayerLinker,
  importTslFixtures,
  settleOpenBets,
  taipeiDate,
  unsettledFixtureDates,
} from './ledgerStore'
import { loadStatshubMatches } from './statshubLoader'
import { parseTslPayload, type TslPayload } from './tsl'

type Sqlite = Database.Database

export const syncLiveResults = async (ledger: Sqlite, mainSqlite: Sqlite | null, cacheDir: string) => {
  const today = taipeiDate(new Date())
  const dates = unsettledFixtureDates(ledger, today)
  if (dates.length === 0) {
    return { dates, updated: 0, settled: settleOpenBets(ledger), errors: [] as string[] }
  }
  const { matches, errors } = await loadStatshubMatches(dates, cacheDir, today)
  const updated = applyStatshubResults(ledger, matches, createPlayerLinker(mainSqlite))
  return { dates, updated, settled: settleOpenBets(ledger), errors }
}

export const importTslPayload = (ledger: Sqlite, mainSqlite: Sqlite | null, payload: TslPayload) => {
  const parsed = parseTslPayload(payload)
  const summary = importTslFixtures(ledger, parsed.fixtures, createPlayerLinker(mainSqlite), new Date().toISOString())
  return { ...summary, skipped: parsed.skipped }
}
