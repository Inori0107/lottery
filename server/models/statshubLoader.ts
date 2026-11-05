import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Sport } from '../../shared/sports'
import { STATSHUB_MATCH_URL, STATSHUB_SOURCE_URL } from './constants'
import { parseStatshubMatchPage, parseStatshubPage, type StatshubMatch } from './statshub'

export const STATSHUB_REQUEST_GAP_MS = 2000
export const STATSHUB_MATCH_GAP_MS = 400
export const STATSHUB_MATCH_PAGE_LIMIT = 50
export const STATSHUB_MAX_RETRIES = 3
export const STATSHUB_INITIAL_BACKOFF_MS = 2000

const STATSHUB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html',
  'Accept-Language': 'en',
}

export const statshubPageUrl = (date: string, sourceUrl = STATSHUB_SOURCE_URL) =>
  `${sourceUrl}?date=${date}`

export const statshubMatchUrl = (sportradarId: number) => `${STATSHUB_MATCH_URL}/${sportradarId}`

export type FetchError = {
  type: 'network' | 'server' | 'client' | 'nodata'
  status: number | null
  message: string
  retryable: boolean
}

export type FetchResult<T> =
  | { ok: true, data: T }
  | { ok: false, error: FetchError }

const classifyError = (status: number | null, message: string): FetchError => {
  if (status === null) {
    return { type: 'network', status: null, message, retryable: true }
  }
  if (status >= 500) {
    return { type: 'server', status, message, retryable: true }
  }
  if (status === 404) {
    return { type: 'nodata', status, message, retryable: false }
  }
  return { type: 'client', status, message, retryable: false }
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export const fetchStatshubHtmlWithRetry = async (
  date: string,
  sourceUrl = STATSHUB_SOURCE_URL,
  maxRetries = STATSHUB_MAX_RETRIES,
  initialBackoff = STATSHUB_INITIAL_BACKOFF_MS,
): Promise<FetchResult<string>> => {
  const url = statshubPageUrl(date, sourceUrl)
  let lastError: FetchError | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = initialBackoff * Math.pow(2, attempt - 1)
      await wait(backoff)
    }

    try {
      const response = await fetch(url, { headers: STATSHUB_HEADERS })
      if (response.ok) {
        return { ok: true, data: await response.text() }
      }
      lastError = classifyError(response.status, `HTTP ${response.status}`)
      if (!lastError.retryable) {
        return { ok: false, error: lastError }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = classifyError(null, message)
    }
  }

  return { ok: false, error: lastError ?? classifyError(null, '未知錯誤') }
}

export const fetchStatshubHtml = async (date: string, sourceUrl = STATSHUB_SOURCE_URL) => {
  const result = await fetchStatshubHtmlWithRetry(date, sourceUrl)
  if (!result.ok) {
    throw new Error(`下載失敗（${result.error.type === 'network' ? '網路錯誤' : `HTTP ${result.error.status}`}）：${statshubPageUrl(date, sourceUrl)}`)
  }
  return result.data
}

export type FailedDatesStore = {
  [sport: string]: {
    [date: string]: { error: string, lastAttempt: string, attempts: number }
  }
}

const FAILED_DATES_FILE = '.data/statshub-failed-dates.json'

export const loadFailedDates = (rootDir: string): FailedDatesStore => {
  const filePath = join(rootDir, FAILED_DATES_FILE)
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as FailedDatesStore
  } catch {
    return {}
  }
}

export const saveFailedDates = (rootDir: string, store: FailedDatesStore): void => {
  const filePath = join(rootDir, FAILED_DATES_FILE)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(store, null, 2))
}

export const recordFailedDate = (
  store: FailedDatesStore,
  sport: string,
  date: string,
  error: string,
): void => {
  if (!store[sport]) store[sport] = {}
  const existing = store[sport][date]
  store[sport][date] = {
    error,
    lastAttempt: new Date().toISOString(),
    attempts: (existing?.attempts ?? 0) + 1,
  }
}

export const clearFailedDate = (store: FailedDatesStore, sport: string, date: string): void => {
  if (store[sport]) {
    delete store[sport][date]
    if (Object.keys(store[sport]).length === 0) {
      delete store[sport]
    }
  }
}

export const getFailedDatesForSport = (store: FailedDatesStore, sport: string): string[] => {
  return Object.keys(store[sport] ?? {}).sort()
}

export const fetchStatshubMatchHtml = async (sportradarId: number) => {
  const url = statshubMatchUrl(sportradarId)
  const response = await fetch(url, { headers: STATSHUB_HEADERS })
  if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）：${url}`)
  return response.text()
}

const shiftDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export type LoadStatshubOptions = {
  sourceUrl?: string
  sport?: Sport
}

export const loadStatshubMatches = async (
  dates: string[],
  cacheDir: string,
  today: string,
  options: LoadStatshubOptions = {},
) => {
  const sourceUrl = options.sourceUrl ?? STATSHUB_SOURCE_URL
  const sport = options.sport ?? 'badminton'
  const wanted = [...new Set(dates.flatMap(date => [shiftDate(date, -1), date, shiftDate(date, 1)]))]
    .filter(date => date <= today)
    .sort()
  const matches: StatshubMatch[] = []
  const errors: string[] = []
  let fetched = 0
  for (const date of wanted) {
    const cached = join(cacheDir, `${date}.html`)
    try {
      if (date < today && existsSync(cached)) {
        matches.push(...parseStatshubPage(readFileSync(cached, 'utf8'), sport).matches)
        continue
      }
      if (fetched > 0) await wait(STATSHUB_REQUEST_GAP_MS)
      fetched += 1
      matches.push(...parseStatshubPage(await fetchStatshubHtml(date, sourceUrl), sport).matches)
    } catch (error) {
      errors.push(`${date}：${(error as Error).message}`)
    }
  }
  return { matches, errors }
}

export const loadStatshubMatchPages = async (ids: number[]) => {
  const matches: StatshubMatch[] = []
  const errors: string[] = []
  const wanted = [...new Set(ids)].slice(0, STATSHUB_MATCH_PAGE_LIMIT)
  for (const [index, sportradarId] of wanted.entries()) {
    try {
      if (index > 0) await wait(STATSHUB_MATCH_GAP_MS)
      const match = parseStatshubMatchPage(await fetchStatshubMatchHtml(sportradarId))
      if (match) matches.push(match)
    } catch (error) {
      errors.push(`${sportradarId}：${(error as Error).message}`)
    }
  }
  return { matches, errors }
}
