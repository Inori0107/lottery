import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATSHUB_START_DATE } from '../server/models/constants'
import { taipeiDate } from '../server/models/ledgerStore'
import { parseStatshubPage } from '../server/models/statshub'
import { fetchStatshubHtml, STATSHUB_REQUEST_GAP_MS as REQUEST_GAP_MS } from '../server/models/statshubLoader'
import { statshubDir as pageDir } from './paths'

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const fetchPage = async (date: string) => {
  const html = await fetchStatshubHtml(date)
  return { html, page: parseStatshubPage(html) }
}

const savePage = (date: string, html: string, hasLiveMatch: boolean) => {
  if (hasLiveMatch) {
    console.log(`${date}：仍有進行中的比賽，不存檔`)
    return false
  }
  writeFileSync(join(pageDir, `${date}.html`), html)
  return true
}

const fetchStatshub = async () => {
  mkdirSync(pageDir, { recursive: true })
  const today = taipeiDate(new Date())
  const yesterday = taipeiDate(new Date(Date.now() - 86_400_000))
  const cached = new Set(readdirSync(pageDir).filter(file => file.endsWith('.html')).map(file => file.replace(/\.html$/, '')))

  const index = await fetchPage(yesterday)
  if (!cached.has(yesterday) && index.page.validDates.includes(yesterday)) {
    if (savePage(yesterday, index.html, index.page.hasLiveMatch)) cached.add(yesterday)
  }

  const pending = index.page.validDates
    .filter(date => date >= STATSHUB_START_DATE && date < today && !cached.has(date))
    .sort()
  console.log(`可用日期 ${index.page.validDates.length} 天，待下載 ${pending.length} 天`)

  for (const date of pending) {
    await wait(REQUEST_GAP_MS)
    const { html, page } = await fetchPage(date)
    savePage(date, html, page.hasLiveMatch)
    console.log(`${date}：單打 ${page.matches.length} 場`)
  }
}

await fetchStatshub()
