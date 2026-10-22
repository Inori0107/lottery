import { z } from 'zod'
import type { Set1Method, PlayerOption, QuoteResponse } from '../../shared/types'
import { SOURCE_URL } from '../models/constants'
import type { ModelPayload } from '../models/backtest'
import { buildQuoteWarnings, emptyMarket, emptyMultiMarket, quotePlayersWithForm } from '../models/quote'
import { isHalfLine } from '../../shared/decision'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)

const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

const bodySchema = z.object({
  discipline: z.enum(['MS', 'WS']),
  awayPlayerId: z.string().min(1),
  homePlayerId: z.string().min(1),
  matchOdds: oddsSchema.optional(),
  game1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.object({
    '2:0': decimalOdds,
    '2:1': decimalOdds,
    '1:2': decimalOdds,
    '0:2': decimalOdds,
  }).optional(),
})

type RatingRow = {
  player_id: string
  name_primary: string
  elo: number
  match_count: number
  game1_count: number
  last_played_on: string | null
  game1_recent: string
}

const toPlayer = (row: RatingRow): PlayerOption & { game1Recent: number[] } => ({
  id: row.player_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.game1_count,
  lastPlayedOn: row.last_played_on,
  game1Recent: JSON.parse(row.game1_recent) as number[],
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩名選手，確認賠率大於 1、盤口線是 .5' })
  }

  const body = parsed.data
  if (body.awayPlayerId === body.homePlayerId) {
    throw createError({ statusCode: 400, statusMessage: '請選擇兩位不同選手' })
  }

  const { sqlite } = useDb()
  const model = sqlite.prepare(`
    SELECT model_version, game1_method, payload, data_through
    FROM model_state
    WHERE discipline = ?
  `).get(body.discipline) as {
    model_version: string
    game1_method: Set1Method
    payload: string
    data_through: string
  } | undefined

  if (!model) {
    throw createError({ statusCode: 503, statusMessage: '這個項目還沒有完成回測' })
  }

  const ratingSql = `
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.game1_count, r.last_played_on, r.game1_recent
    FROM player_ratings r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.discipline = ? AND r.player_id = ?
  `
  const awayRow = sqlite.prepare(ratingSql).get(body.discipline, body.awayPlayerId) as RatingRow | undefined
  const homeRow = sqlite.prepare(ratingSql).get(body.discipline, body.homePlayerId) as RatingRow | undefined
  const missing = (id: string): PlayerOption & { game1Recent: number[] } => ({
    id,
    name: '找不到選手',
    elo: 1500,
    matchCount: 0,
    set1Count: 0,
    lastPlayedOn: null,
    game1Recent: [],
  })
  const away = awayRow ? toPlayer(awayRow) : missing(body.awayPlayerId)
  const home = homeRow ? toPlayer(homeRow) : missing(body.homePlayerId)
  const payload = JSON.parse(model.payload) as ModelPayload
  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const shrinkMode = payload.shrink?.mode ?? (payload.shrink?.enabled ? 'full' : 'raw')
  const shrinkEnabled = shrinkMode !== 'raw'
  const quoted = quotePlayersWithForm(away, home, {
    method: model.game1_method,
    coefficients: payload.coefficients,
    bins: payload.bins,
    shrinkMode,
    matchCalibration: payload.test?.match?.calibration ?? [],
    game1Calibration: payload.test?.game1?.calibration ?? [],
    rally: payload.rally,
    totalsCalibration: payload.test?.totals?.calibration ?? [],
    handicapCalibration: payload.test?.handicap?.calibration ?? [],
    correctScoreCalibration: payload.test?.correctScore?.calibration ?? [],
  }, {
    match: body.matchOdds,
    game1: body.game1Odds,
    totals: body.totalOdds,
    handicap: body.handicapOdds,
    correctScore: body.correctScoreOdds,
  }, model.data_through, asOf)

  if (!awayRow || !homeRow) {
    const reason = '選手不在這個項目的資料裡'
    quoted.matchWinner = emptyMarket(reason)
    quoted.set1Winner = emptyMarket(reason)
    quoted.totalPoints = quoted.totalPoints && emptyMultiMarket(reason)
    quoted.pointsHandicap = quoted.pointsHandicap && emptyMultiMarket(reason)
    quoted.correctScore = quoted.correctScore && emptyMultiMarket(reason)
  }

  const response: QuoteResponse = {
    sport: 'badminton',
    discipline: body.discipline,
    modelVersion: model.model_version,
    set1Method: model.game1_method,
    dataThrough: model.data_through,
    asOf,
    shrinkEnabled,
    sourceUrl: SOURCE_URL,
    away,
    home,
    isHome: false,
    warnings: awayRow && homeRow
      ? buildQuoteWarnings(away, home, asOf, model.data_through, shrinkEnabled)
      : [],
    matchWinner: quoted.matchWinner,
    set1Winner: quoted.set1Winner,
    totalPoints: quoted.totalPoints,
    pointsHandicap: quoted.pointsHandicap,
    correctScore: quoted.correctScore,
    setHandicap: null,
    set1TotalPoints: null,
    set1PointsHandicap: null,
  }
  return response
})
