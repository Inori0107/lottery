import type Database from 'better-sqlite3'
import type { TslImportSummary } from '../../shared/types'
import { VOLLEYBALL_STATSHUB_SOURCE_URL } from './constants'
import { normalizeCouponDate } from '../../shared/tslTime'
import {
  applyStatshubResults,
  ensureVolleyballTeamsFromMatches,
  rememberVolleyballTeamNames,
  fixtureIdsNeedingMatchPage,
  importTslFixtures,
  saveTslImportSummary,
  settleOpenBets,
  settleOpenTickets,
  taipeiDate,
  unsettledFixtureDates,
} from './ledgerStore'
import { loadStatshubMatchPages, loadStatshubMatches } from './statshubLoader'
import type { StatshubMatch } from './statshub'
import { parseTslPayload, type TslPayload } from './tsl'

type Sqlite = Database.Database

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const isSqliteBusy = (error: unknown) => {
  const code = (error as { code?: string }).code ?? ''
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT'
}

const applyMatches = async (ledger: Sqlite, mainSqlite: Sqlite | null, matches: StatshubMatch[]) => {
  if (matches.length === 0) return 0
  if (mainSqlite) {
    ensureVolleyballTeamsFromMatches(mainSqlite, matches)
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const updated = applyStatshubResults(ledger, matches, mainSqlite)
      if (mainSqlite) rememberVolleyballTeamNames(mainSqlite, ledger, matches)
      return updated
    } catch (error) {
      if (!isSqliteBusy(error) || attempt === 7) throw error
      await wait(1500 * (attempt + 1))
    }
  }
  return 0
}

const supplementFromMatchPages = async (ledger: Sqlite, mainSqlite: Sqlite | null, knownIds: Set<number>, ids?: number[]) => {
  const wanted = ids ?? fixtureIdsNeedingMatchPage(ledger, taipeiDate(new Date()), knownIds)
  if (wanted.length === 0) return { updated: 0, errors: [] as string[], fetched: 0 }
  const extra = await loadStatshubMatchPages(wanted)
  return {
    updated: await applyMatches(ledger, mainSqlite, extra.matches),
    errors: extra.errors,
    fetched: wanted.length,
  }
}

export const syncLiveResults = async (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  cacheDir: string,
  volleyballCacheDir = cacheDir,
) => {
  const today = taipeiDate(new Date())
  const dates = unsettledFixtureDates(ledger, today)
  const settle = () => {
    const bets = settleOpenBets(ledger)
    const tickets = settleOpenTickets(ledger)
    return bets + tickets
  }
  if (dates.length === 0) {
    const extra = await supplementFromMatchPages(ledger, mainSqlite, new Set())
    return { dates, updated: extra.updated, settled: settle(), errors: extra.errors }
  }
  const badminton = await loadStatshubMatches(dates, cacheDir, today)
  const volleyball = await loadStatshubMatches(dates, volleyballCacheDir, today, {
    sourceUrl: VOLLEYBALL_STATSHUB_SOURCE_URL,
    sport: 'volleyball',
  })
  const matches = [...badminton.matches, ...volleyball.matches]
  const errors = [...badminton.errors, ...volleyball.errors]
  let updated = await applyMatches(ledger, mainSqlite, matches)
  const extra = await supplementFromMatchPages(ledger, mainSqlite, new Set(matches.map(match => match.sportradarId)))
  updated += extra.updated
  return { dates, updated, settled: settle(), errors: [...errors, ...extra.errors] }
}

export const importTslPayload = (
  ledger: Sqlite,
  mainSqlite: Sqlite | null,
  payload: TslPayload,
  now = new Date(),
): TslImportSummary => {
  const parsed = parseTslPayload(payload)
  const capturedAt = new Date(payload.capturedAt)
  const stamp = Number.isFinite(capturedAt.getTime()) && capturedAt.getTime() <= now.getTime() + 300_000
    ? capturedAt
    : now
  const imported = importTslFixtures(
    ledger,
    parsed.fixtures,
    stamp.toISOString(),
    mainSqlite,
  )
  const summary: TslImportSummary = {
    received: payload.events.length,
    imported: imported.fixtures,
    fixtures: imported.fixtures,
    snapshots: imported.snapshots,
    skipped: parsed.skipped,
    unlinked: imported.unlinked,
    pending: imported.pending,
    couponDate: normalizeCouponDate(payload.date, now),
  }
  saveTslImportSummary(ledger, summary)
  return summary
}
