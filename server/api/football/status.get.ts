import type { LatestMatchInfo, StatusResponse } from '../../../shared/types'
import { FOOTBALL_SOURCE_URL, STALE_DATA_WARNING_DAYS } from '../../models/constants'
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
  try {
    const { sqlite } = useDb()
    
    const tableExists = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='football_model_state'
    `).get()

    if (!tableExists) {
      return {
        ready: false,
        dataThrough: null,
        latestMatch: {
          badminton: { MS: emptyLatestMatch(), WS: emptyLatestMatch() },
          volleyball: { M: emptyLatestMatch(), W: emptyLatestMatch() },
          football: { FM: emptyLatestMatch(), FW: emptyLatestMatch() },
        },
        models: [],
        counts: {
          badminton: { MS: 0, WS: 0 },
          volleyball: { M: 0, W: 0 },
          football: { FM: 0, FW: 0 },
        },
        notes: [
          '足球模型尚未建立。由於 Sportradar StatsHub 足球資料尚待確認，目前只能同步運彩賠率，無法產生模型預測。',
          '已同步的賽事會顯示去水盤口機率與標記「模型資料不足，僅供參考」。',
        ],
      }
    }

    const models = sqlite.prepare(`
      SELECT discipline, model_version, set1_method, data_through
      FROM football_model_state
    `).all() as Array<{
      discipline: string
      model_version: string
      set1_method: string
      data_through: string
    }>

    const counts = sqlite.prepare(`
      SELECT discipline, COUNT(*) as count
      FROM football_team_ratings
      GROUP BY discipline
    `).all() as Array<{ discipline: string, count: number }>

    const countMap = Object.fromEntries(counts.map(row => [row.discipline, row.count])) as Record<string, number>

    let fmLatest: string | null = null
    let fwLatest: string | null = null

    const matchesTableExists = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='football_matches'
    `).get()

    if (matchesTableExists) {
      const footballLatest = sqlite.prepare(`
        SELECT discipline, MAX(played_on) AS latest
        FROM football_matches
        WHERE include_match = 1
        GROUP BY discipline
      `).all() as Array<{ discipline: string, latest: string | null }>

      const footballLatestMap = new Map(footballLatest.map(row => [row.discipline, row.latest]))
      fmLatest = footballLatestMap.get('FM') ?? null
      fwLatest = footballLatestMap.get('FW') ?? null
    }

    return {
      ready: models.length > 0,
      dataThrough: models[0]?.data_through ?? null,
      latestMatch: {
        badminton: { MS: emptyLatestMatch(), WS: emptyLatestMatch() },
        volleyball: { M: emptyLatestMatch(), W: emptyLatestMatch() },
        football: {
          FM: { date: fmLatest, staleWarning: computeStaleWarning(fmLatest, STALE_DATA_WARNING_DAYS) },
          FW: { date: fwLatest, staleWarning: computeStaleWarning(fwLatest, STALE_DATA_WARNING_DAYS) },
        },
      },
      models: models.map(model => ({
        sport: 'football' as const,
        discipline: model.discipline as 'FM' | 'FW',
        modelVersion: model.model_version,
        set1Method: model.set1_method,
        dataThrough: model.data_through,
      })),
      counts: {
        badminton: { MS: 0, WS: 0 },
        volleyball: { M: 0, W: 0 },
        football: {
          FM: countMap.FM ?? 0,
          FW: countMap.FW ?? 0,
        },
      },
      notes: [
        `資料來源：${FOOTBALL_SOURCE_URL}`,
        '目前足球模型僅供研究，尚未完成校準與回測。',
      ],
    }
  } catch {
    return {
      ready: false,
      dataThrough: null,
      latestMatch: {
        badminton: { MS: emptyLatestMatch(), WS: emptyLatestMatch() },
        volleyball: { M: emptyLatestMatch(), W: emptyLatestMatch() },
        football: { FM: emptyLatestMatch(), FW: emptyLatestMatch() },
      },
      models: [],
      counts: {
        badminton: { MS: 0, WS: 0 },
        volleyball: { M: 0, W: 0 },
        football: { FM: 0, FW: 0 },
      },
      notes: ['足球模型狀態讀取失敗'],
    }
  }
})
