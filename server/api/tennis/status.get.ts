import { existsSync } from 'node:fs'
import type { StatusResponse } from '../../../shared/types'

export default defineEventHandler((): StatusResponse => {
  const empty: StatusResponse = {
    ready: false,
    dataThrough: null,
    models: [],
    counts: {
      badminton: { MS: 0, WS: 0 },
      volleyball: { M: 0, W: 0 },
      tennis: { ATP: 0, WTA: 0 },
    },
  }

  const { dbFile } = useRuntimeConfig()
  if (!existsSync(dbFile)) return empty

  const { sqlite } = useDb()
  const table = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tennis_model_state'`).get()
  if (!table) return empty

  const models = sqlite.prepare(`
    SELECT discipline, model_version, set1_method, data_through
    FROM tennis_model_state
    ORDER BY discipline
  `).all() as Array<{
    discipline: 'ATP' | 'WTA'
    model_version: string
    set1_method: string
    data_through: string
  }>

  const counts = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN discipline = 'ATP' THEN 1 ELSE 0 END) AS atp,
      SUM(CASE WHEN discipline = 'WTA' THEN 1 ELSE 0 END) AS wta
    FROM tennis_matches
    WHERE include_match = 1
  `).get() as { atp: number | null, wta: number | null }

  return {
    ready: models.length > 0,
    dataThrough: models[0]?.data_through ?? null,
    models: models.map(model => ({
      sport: 'tennis',
      discipline: model.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
    })),
    counts: {
      badminton: { MS: 0, WS: 0 },
      volleyball: { M: 0, W: 0 },
      tennis: { ATP: counts.atp ?? 0, WTA: counts.wta ?? 0 },
    },
  }
})
