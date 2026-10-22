import { existsSync } from 'node:fs'
import type { Discipline, Sport, StatusResponse } from '../../shared/types'

export default defineEventHandler((): StatusResponse => {
  const { dbFile } = useRuntimeConfig()
  if (!existsSync(dbFile)) {
    return {
      ready: false,
      dataThrough: null,
      models: [],
      counts: {
        badminton: { MS: 0, WS: 0 },
        volleyball: { M: 0, W: 0 },
        tennis: { ATP: 0, WTA: 0 },
      },
    }
  }

  const { sqlite } = useDb()
  const models = sqlite.prepare(`
    SELECT sport, discipline, model_version, game1_method, data_through
    FROM model_state
    ORDER BY sport, discipline
  `).all() as Array<{
    sport: Sport | null
    discipline: Discipline
    model_version: string
    game1_method: string
    data_through: string
  }>

  const badmintonCounts = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN discipline = 'MS' THEN 1 ELSE 0 END) AS ms,
      SUM(CASE WHEN discipline = 'WS' THEN 1 ELSE 0 END) AS ws
    FROM matches
    WHERE include_match = 1 AND (sport IS NULL OR sport = 'badminton')
  `).get() as { ms: number | null, ws: number | null }

  const volleyballCountsQuery = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_matches'
  `).get()

  let volleyballCounts = { m: 0, w: 0 }
  if (volleyballCountsQuery) {
    volleyballCounts = sqlite.prepare(`
      SELECT
        SUM(CASE WHEN discipline = 'M' THEN 1 ELSE 0 END) AS m,
        SUM(CASE WHEN discipline = 'W' THEN 1 ELSE 0 END) AS w
      FROM volleyball_matches
      WHERE include_match = 1
    `).get() as { m: number | null, w: number | null } ?? { m: 0, w: 0 }
  }

  const tennisCountsQuery = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='tennis_matches'
  `).get()
  let tennisCounts = { atp: 0, wta: 0 }
  if (tennisCountsQuery) {
    tennisCounts = sqlite.prepare(`
      SELECT
        SUM(CASE WHEN discipline = 'ATP' THEN 1 ELSE 0 END) AS atp,
        SUM(CASE WHEN discipline = 'WTA' THEN 1 ELSE 0 END) AS wta
      FROM tennis_matches
      WHERE include_match = 1
    `).get() as { atp: number | null, wta: number | null } ?? { atp: 0, wta: 0 }
  }

  const tennisModels = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='tennis_model_state'
  `).get()
    ? sqlite.prepare(`
      SELECT 'tennis' AS sport, discipline, model_version, set1_method AS game1_method, data_through
      FROM tennis_model_state
      ORDER BY discipline
    `).all() as Array<{
      sport: Sport
      discipline: Discipline
      model_version: string
      game1_method: string
      data_through: string
    }>
    : []

  const allModels = [...models, ...tennisModels]

  return {
    ready: allModels.length > 0,
    dataThrough: allModels[0]?.data_through ?? null,
    models: allModels.map(model => ({
      sport: model.sport ?? 'badminton',
      discipline: model.discipline,
      modelVersion: model.model_version,
      set1Method: model.game1_method,
      dataThrough: model.data_through,
    })),
    counts: {
      badminton: { MS: badmintonCounts.ms ?? 0, WS: badmintonCounts.ws ?? 0 },
      volleyball: { M: volleyballCounts.m ?? 0, W: volleyballCounts.w ?? 0 },
      tennis: { ATP: tennisCounts.atp ?? 0, WTA: tennisCounts.wta ?? 0 },
    },
  }
})
