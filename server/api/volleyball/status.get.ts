import { existsSync } from 'node:fs'
import type { LatestMatchInfo, StatusResponse } from '../../../shared/types'
import { STALE_DATA_WARNING_DAYS } from '../../models/constants'
import { taipeiDate } from '../../../shared/tslTime'

const emptyLatestMatch = (): LatestMatchInfo => ({ date: null, staleWarning: null })

const computeStaleWarning = (lastDate: string | null, thresholdDays: number): string | null => {
  if (!lastDate) return null
  const today = taipeiDate(new Date())
  const diff = Math.floor((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${lastDate}T00:00:00+08:00`)) / 86_400_000)
  if (diff > thresholdDays) {
    return `最新已匯入比賽距今 ${diff} 天，超過 ${thresholdDays} 天警戒值`
  }
  return null
}

export default defineEventHandler((): StatusResponse => {
  const empty: StatusResponse = {
    ready: false,
    dataThrough: null,
    latestMatch: {
      badminton: { MS: emptyLatestMatch(), WS: emptyLatestMatch() },
      volleyball: { M: emptyLatestMatch(), W: emptyLatestMatch() },
    },
    models: [],
    counts: {
      badminton: { MS: 0, WS: 0 },
      volleyball: { M: 0, W: 0 },
    },
    notes: ['排球歷史尚未匯入。來源只有台灣運彩 StatsHub，不是完整聯賽檔。'],
  }

  const { dbFile } = useRuntimeConfig()
  if (!existsSync(dbFile)) return empty

  const { sqlite } = useDb()
  const table = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_model_state'`).get()
  if (!table) return empty

  const models = sqlite.prepare(`
    SELECT discipline, model_version, set1_method, data_through
    FROM volleyball_model_state
    ORDER BY discipline
  `).all() as Array<{
    discipline: 'M' | 'W'
    model_version: string
    set1_method: string
    data_through: string
  }>

  const matchesTable = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_matches'`).get()
  const counts = matchesTable
    ? sqlite.prepare(`
      SELECT
        SUM(CASE WHEN discipline = 'M' THEN 1 ELSE 0 END) AS m,
        SUM(CASE WHEN discipline = 'W' THEN 1 ELSE 0 END) AS w
      FROM volleyball_matches
      WHERE include_match = 1
    `).get() as { m: number | null, w: number | null }
    : { m: 0, w: 0 }

  let mLatest: string | null = null
  let wLatest: string | null = null

  if (matchesTable) {
    const volleyballLatest = sqlite.prepare(`
      SELECT discipline, MAX(played_on) AS latest
      FROM volleyball_matches
      WHERE include_match = 1
      GROUP BY discipline
    `).all() as Array<{ discipline: string, latest: string | null }>

    const volleyballLatestMap = new Map(volleyballLatest.map(row => [row.discipline, row.latest]))
    mLatest = volleyballLatestMap.get('M') ?? null
    wLatest = volleyballLatestMap.get('W') ?? null
  }

  return {
    ready: models.length > 0,
    dataThrough: models[0]?.data_through ?? null,
    latestMatch: {
      badminton: { MS: emptyLatestMatch(), WS: emptyLatestMatch() },
      volleyball: {
        M: { date: mLatest, staleWarning: computeStaleWarning(mLatest, STALE_DATA_WARNING_DAYS) },
        W: { date: wLatest, staleWarning: computeStaleWarning(wLatest, STALE_DATA_WARNING_DAYS) },
      },
    },
    models: models.map(model => ({
      sport: 'volleyball',
      discipline: model.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
    })),
    counts: {
      badminton: { MS: 0, WS: 0 },
      volleyball: { M: counts.m ?? 0, W: counts.w ?? 0 },
    },
    notes: [
      '排球賽果只含台灣運彩有開盤的場次（StatsHub sport/23），不是完整聯賽檔。',
      `目前男排 ${counts.m ?? 0} 場、女排 ${counts.w ?? 0} 場；樣本遠少於羽球，只適合作研究對照。`,
    ],
  }
})
