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

  return {
    ready: models.length > 0,
    dataThrough: models[0]?.data_through ?? null,
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
      tennis: { ATP: 0, WTA: 0 },
    },
  }
})
