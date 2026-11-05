import type { StatusResponse } from '../../../shared/types'
import { FOOTBALL_SOURCE_URL } from '../../models/constants'

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

    return {
      ready: models.length > 0,
      dataThrough: models[0]?.data_through ?? null,
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
