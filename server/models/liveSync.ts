import type Database from 'better-sqlite3'
import { TENNIS_STATSHUB_SOURCE_URL, VOLLEYBALL_STATSHUB_SOURCE_URL } from './constants'
import {
  applyStatshubResults,
  createPlayerLinker,
  ensureTennisPlayersFromMatches,
  ensureVolleyballTeamsFromMatches,
  rememberVolleyballTeamNames,
  fixtureIdsNeedingMatchPage,
  importTslFixtures,
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
    ensureTennisPlayersFromMatches(mainSqlite, matches)
    ensureVolleyballTeamsFromMatches(mainSqlite, matches)
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const updated = applyStatshubResults(ledger, matches, createPlayerLinker(mainSqlite))
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
  tennisCacheDir = cacheDir,
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
  const tennis = await loadStatshubMatches(dates, tennisCacheDir, today, {
    sourceUrl: TENNIS_STATSHUB_SOURCE_URL,
    sport: 'tennis',
  })
  const matches = [...badminton.matches, ...volleyball.matches, ...tennis.matches]
  const errors = [...badminton.errors, ...volleyball.errors, ...tennis.errors]
  let updated = await applyMatches(ledger, mainSqlite, matches)
  const extra = await supplementFromMatchPages(ledger, mainSqlite, new Set(matches.map((match) => match.sportradarId)))
  updated += extra.updated
  return { dates, updated, settled: settle(), errors: [...errors, ...extra.errors] }
}

export const importTslPayload = async (ledger: Sqlite, mainSqlite: Sqlite | null, payload: TslPayload) => {
  const parsed = parseTslPayload(payload)
  const capturedAt = new Date(payload.capturedAt)
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 300_000) throw new Error('賠率抓取時間無效')
  const summary = importTslFixtures(ledger, parsed.fixtures, createPlayerLinker(mainSqlite), capturedAt.toISOString())
  const find = ledger.prepare('SELECT away_player_id, home_player_id FROM fixtures WHERE sportradar_id = ?')
  const unlinkedIds = parsed.fixtures
    .map((fixture) => fixture.sportradarId)
    .filter((id) => {
      const row = find.get(id) as { away_player_id: string | null, home_player_id: string | null } | undefined
      return Boolean(row && (!row.away_player_id || !row.home_player_id))
    })
  const extra = await supplementFromMatchPages(ledger, mainSqlite, new Set(), unlinkedIds)
  return {
    ...summary,
    skipped: parsed.skipped,
    received: payload.events.length,
    listed: payload.meta?.listed ?? payload.events.length,
    groups: payload.meta?.groups ?? null,
    matchPages: extra.fetched,
  }
}
