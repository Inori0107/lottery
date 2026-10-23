import type Database from 'better-sqlite3'
import type { TslImportSummary } from '../../shared/types'
import { normalizeCouponDate } from '../../shared/tslTime'
import {
  applyStatshubResults,
  createPlayerLinker,
  importTslFixtures,
  saveTslImportSummary,
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

export const importTslPayload = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  payload: TslPayload,
  now = new Date(),
): TslImportSummary => {
  const parsed = parseTslPayload(payload)
  const capturedAt = now.toISOString()
  const imported = importTslFixtures(ledger, parsed.fixtures, createPlayerLinker(mainSqlite), capturedAt)
  const summary: TslImportSummary = {
    received: payload.events.length,
    imported: imported.fixtures,
    fixtures: imported.fixtures,
    snapshots: imported.snapshots,
    skipped: parsed.skipped,
    unlinked: imported.unlinked,
    couponDate: normalizeCouponDate(payload.date, now),
  }
  saveTslImportSummary(ledger, summary)
  return summary
}
