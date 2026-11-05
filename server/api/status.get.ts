import { existsSync } from 'node:fs'
import type { Discipline, LatestMatchInfo, Sport, StatusResponse } from '../../shared/types'
import { STALE_DATA_WARNING_DAYS } from '../models/constants'
import { taipeiDate } from '../../shared/tslTime'

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
  const { dbFile } = useRuntimeConfig()
  if (!existsSync(dbFile)) {
    return {
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
      notes: [],
    }
  }

  const { sqlite } = useDb()
  const models = sqlite.prepare(`
    SELECT sport, discipline, model_version, set1_method, data_through
    FROM model_state
    WHERE sport IS NULL OR sport = 'badminton'
    ORDER BY sport, discipline
  `).all() as Array<{
    sport: Sport | null
    discipline: Discipline
    model_version: string
    set1_method: string
    data_through: string
  }>

  const badmintonCounts = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN discipline = 'MS' THEN 1 ELSE 0 END) AS ms,
      SUM(CASE WHEN discipline = 'WS' THEN 1 ELSE 0 END) AS ws
    FROM matches
    WHERE include_match = 1 AND (sport IS NULL OR sport = 'badminton')
  `).get() as { ms: number | null, ws: number | null }

  const badmintonLatest = sqlite.prepare(`
    SELECT discipline, MAX(played_on) AS latest
    FROM matches
    WHERE include_match = 1 AND (sport IS NULL OR sport = 'badminton')
    GROUP BY discipline
  `).all() as Array<{ discipline: string, latest: string | null }>

  const badmintonLatestMap = new Map(badmintonLatest.map(row => [row.discipline, row.latest]))
  const msLatest = badmintonLatestMap.get('MS') ?? null
  const wsLatest = badmintonLatestMap.get('WS') ?? null

  const volleyballCountsQuery = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_matches'
  `).get()

  let volleyballCounts = { m: 0, w: 0 }
  let mLatest: string | null = null
  let wLatest: string | null = null

  if (volleyballCountsQuery) {
    volleyballCounts = sqlite.prepare(`
      SELECT
        SUM(CASE WHEN discipline = 'M' THEN 1 ELSE 0 END) AS m,
        SUM(CASE WHEN discipline = 'W' THEN 1 ELSE 0 END) AS w
      FROM volleyball_matches
      WHERE include_match = 1
    `).get() as { m: number | null, w: number | null } ?? { m: 0, w: 0 }

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
      badminton: {
        MS: { date: msLatest, staleWarning: computeStaleWarning(msLatest, STALE_DATA_WARNING_DAYS) },
        WS: { date: wsLatest, staleWarning: computeStaleWarning(wsLatest, STALE_DATA_WARNING_DAYS) },
      },
      volleyball: {
        M: { date: mLatest, staleWarning: computeStaleWarning(mLatest, STALE_DATA_WARNING_DAYS) },
        W: { date: wLatest, staleWarning: computeStaleWarning(wLatest, STALE_DATA_WARNING_DAYS) },
      },
    },
    models: models.map(model => ({
      sport: model.sport ?? 'badminton',
      discipline: model.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
    })),
    counts: {
      badminton: { MS: badmintonCounts.ms ?? 0, WS: badmintonCounts.ws ?? 0 },
      volleyball: { M: volleyballCounts.m ?? 0, W: volleyballCounts.w ?? 0 },
    },
    notes: [
      `羽球公開賽史男單 ${badmintonCounts.ms ?? 0} 場、女單 ${badmintonCounts.ws ?? 0} 場。`,
      volleyballCounts.m || volleyballCounts.w
        ? `排球只含運彩有開盤的場次，男排 ${volleyballCounts.m ?? 0} 場、女排 ${volleyballCounts.w ?? 0} 場，可信度低於羽球。`
        : '排球歷史尚未匯入；來源只有運彩版 StatsHub，不是完整聯賽檔。',
    ],
  }
})
