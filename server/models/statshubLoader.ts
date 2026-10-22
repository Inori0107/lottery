import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATSHUB_SOURCE_URL } from './constants'
import { parseStatshubPage, type StatshubMatch } from './statshub'

export const STATSHUB_REQUEST_GAP_MS = 2000

const statshubPageUrl = (date: string) => `${STATSHUB_SOURCE_URL}?date=${date}`

export const fetchStatshubHtml = async (date: string) => {
  const response = await fetch(statshubPageUrl(date), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'en',
    },
  })
  if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）：${statshubPageUrl(date)}`)
  return response.text()
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const shiftDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export const loadStatshubMatches = async (dates: string[], cacheDir: string, today: string) => {
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
        matches.push(...parseStatshubPage(readFileSync(cached, 'utf8')).matches)
        continue
      }
      if (fetched > 0) await wait(STATSHUB_REQUEST_GAP_MS)
      fetched += 1
      matches.push(...parseStatshubPage(await fetchStatshubHtml(date)).matches)
    } catch (error) {
      errors.push(`${date}：${(error as Error).message}`)
    }
  }
  return { matches, errors }
}
