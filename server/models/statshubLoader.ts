import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sport } from '../../shared/sports'
import { STATSHUB_MATCH_URL, STATSHUB_SOURCE_URL } from './constants'
import { parseStatshubMatchPage, parseStatshubPage, type StatshubMatch } from './statshub'

export const STATSHUB_REQUEST_GAP_MS = 2000
export const STATSHUB_MATCH_GAP_MS = 400
export const STATSHUB_MATCH_PAGE_LIMIT = 50

const STATSHUB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html',
  'Accept-Language': 'en',
}

export const statshubPageUrl = (date: string, sourceUrl = STATSHUB_SOURCE_URL) =>
  `${sourceUrl}?date=${date}`

export const statshubMatchUrl = (sportradarId: number) => `${STATSHUB_MATCH_URL}/${sportradarId}`

export const fetchStatshubHtml = async (date: string, sourceUrl = STATSHUB_SOURCE_URL) => {
  const response = await fetch(statshubPageUrl(date, sourceUrl), { headers: STATSHUB_HEADERS })
  if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）：${statshubPageUrl(date, sourceUrl)}`)
  return response.text()
}

export const fetchStatshubMatchHtml = async (sportradarId: number) => {
  const url = statshubMatchUrl(sportradarId)
  const response = await fetch(url, { headers: STATSHUB_HEADERS })
  if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）：${url}`)
  return response.text()
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

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
