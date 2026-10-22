import { existsSync } from 'node:fs'
import type { Discipline, StatusResponse } from '../../shared/types'

export default defineEventHandler((): StatusResponse => {
  const { dbFile } = useRuntimeConfig()
  if (!existsSync(dbFile)) {
    return { ready: false, dataThrough: null, models: [], counts: { MS: 0, WS: 0 } }
  }

  const { sqlite } = useDb()
  const models = sqlite.prepare(`
    SELECT discipline, model_version, game1_method, data_through
    FROM model_state
    ORDER BY discipline
  `).all() as Array<{
    discipline: Discipline
    model_version: string
    game1_method: string
    data_through: string
  }>
  const counts = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN discipline = 'MS' THEN 1 ELSE 0 END) AS ms,
      SUM(CASE WHEN discipline = 'WS' THEN 1 ELSE 0 END) AS ws
    FROM matches
    WHERE include_match = 1
  `).get() as { ms: number | null, ws: number | null }

  return {
    ready: models.length > 0,
    dataThrough: models[0]?.data_through ?? null,
    models: models.map(model => ({
      discipline: model.discipline,
      modelVersion: model.model_version,
      game1Method: model.game1_method,
      dataThrough: model.data_through,
    })),
    counts: { MS: counts.ms ?? 0, WS: counts.ws ?? 0 },
  }
})
