import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import type { LedgerDatabase } from '../db/ledger'
import type { Set1Method, PlayerOption, QuoteResponse } from '../../shared/types'
import { SOURCE_URL } from './constants'
import type { ModelPayload } from './backtest'
import { buildQuoteWarnings, emptyMarket, emptyMultiMarket, quotePlayersWithForm } from './quote'
import { isHalfLine } from '../../shared/decision'
import { deployableCalibration } from './calibration'
import { savePrediction } from './predictionLedger'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)

const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

export const badmintonQuoteSchema = z.object({
  fixtureId: z.number().int().nullable().optional(),
  sourceMarketIds: z.record(z.string(), z.string()).optional(),
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
  set1TotalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  set1HandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  setCountOdds: z.record(z.string(), decimalOdds).optional(),
})

type RatingRow = {
  player_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
  set1_recent: string
}

const toPlayer = (row: RatingRow): PlayerOption & { game1Recent: number[] } => ({
  id: row.player_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.set1_count,
  lastPlayedOn: row.last_played_on,
  game1Recent: JSON.parse(row.set1_recent) as number[],
})

export const buildBadmintonQuote = (sqlite: Database, ledger: LedgerDatabase, body: z.infer<typeof badmintonQuoteSchema>) => {
  if (body.awayPlayerId === body.homePlayerId) throw new Error('請選擇兩位不同選手')
  const model = sqlite.prepare(`
    SELECT model_version, set1_method, payload, data_through
    FROM model_state
    WHERE discipline = ? AND (sport IS NULL OR sport = 'badminton')
  `).get(body.discipline) as {
    model_version: string
    set1_method: Set1Method
    payload: string
    data_through: string
  } | undefined

  if (!model) {
    throw new Error('這個項目還沒有完成回測')
  }

  const ratingSql = `
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.set1_recent
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
  const calibration = deployableCalibration(payload)
  const validationReady = payload.evaluationProtocol === 'temporal-calibration-v1'
    && (calibration.match ?? []).reduce((n, b) => n + b.n, 0) >= 200
    && payload.test.match.n >= 200
    && payload.test.match.logLoss !== null
    && payload.test.match.baselineLogLoss !== null
    && payload.test.match.logLoss <= payload.test.match.baselineLogLoss
  const quoted = quotePlayersWithForm(away, home, {
    method: model.set1_method,
    coefficients: payload.coefficients,
    bins: payload.bins,
    shrinkMode,
    validationReady,
    game1ValidationReady: validationReady && payload.test.game1.logLoss !== null && payload.test.game1.matchEloLogLoss !== null && payload.test.game1.logLoss <= payload.test.game1.matchEloLogLoss,
    matchCalibration: calibration.match,
    game1Calibration: calibration.game1,
    matchReliability: validationReady ? payload.test.match.calibration : [],
    game1Reliability: validationReady ? payload.test.game1.calibration : [],
    rally: payload.rally,
    totalsCalibration: calibration.totals,
    handicapCalibration: calibration.handicap,
    correctScoreCalibration: calibration.correctScore,
  }, {
    match: body.matchOdds,
    game1: body.game1Odds,
    totals: body.totalOdds,
    handicap: body.handicapOdds,
    correctScore: body.correctScoreOdds,
    set1Totals: body.set1TotalOdds,
    set1Handicap: body.set1HandicapOdds,
    setCount: body.setCountOdds,
  }, model.data_through, asOf)

  if (!awayRow || !homeRow) {
    const reason = '選手不在這個項目的資料裡'
    quoted.matchWinner = emptyMarket(reason)
    quoted.set1Winner = emptyMarket(reason)
    quoted.totalPoints = quoted.totalPoints && emptyMultiMarket(reason)
    quoted.pointsHandicap = quoted.pointsHandicap && emptyMultiMarket(reason)
    quoted.correctScore = quoted.correctScore && emptyMultiMarket(reason)
    quoted.set1TotalPoints = quoted.set1TotalPoints && emptyMultiMarket(reason)
    quoted.set1PointsHandicap = quoted.set1PointsHandicap && emptyMultiMarket(reason)
    quoted.setCount = quoted.setCount && emptyMultiMarket(reason)
  }

  const response: QuoteResponse = {
    evaluationProtocol: payload.evaluationProtocol ?? null,
    sport: 'badminton',
    discipline: body.discipline,
    modelVersion: model.model_version,
    set1Method: model.set1_method,
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
    set1TotalPoints: quoted.set1TotalPoints,
    set1PointsHandicap: quoted.set1PointsHandicap,
    setCount: quoted.setCount,
  }
  if (!validationReady) response.warnings.push('此模型尚未完成新的獨立校準流程；目前僅供研究，請執行 npm run update:data 重新回測。')
  return savePrediction(ledger, response, body.fixtureId ?? null, { input: body, model: payload }, body.sourceMarketIds)
}
