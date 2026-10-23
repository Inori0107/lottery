import { z } from 'zod'
import {
  TENNIS_BO3_CORRECT_SCORES,
  TENNIS_BO5_CORRECT_SCORES,
  type PlayerOption,
  type QuoteResponse,
  type Set1Method,
  type TennisDiscipline,
} from '../../../shared/types'
import { tennisBestOf } from '../../../shared/sports'
import { isHalfLine, calibrateProbability } from '../../../shared/decision'
import { buildMarketQuote, buildMultiMarketQuote, emptyMarket, emptyMultiMarket } from '../../models/quote'
import {
  TENNIS_MIN_MATCH_SAMPLE,
  TENNIS_MIN_SET1_SAMPLE,
  TENNIS_SOURCE_URL,
} from '../../models/constants'
import {
  coversHandicap,
  distributionMean,
  fairLine,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  probabilityAbove,
  tennisMatchDistribution,
  type TennisBestOf,
} from '../../models/tennisRally'
import { effectiveRating, expectedScoreWithSurface, type Surface } from '../../models/tennisElo'
import type { TennisModelPayload } from '../../models/tennisBacktest'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)
const oddsSchema = z.object({ away: decimalOdds, home: decimalOdds })

const bodySchema = z.object({
  discipline: z.enum(['ATP', 'WTA']),
  awayPlayerId: z.string().min(1),
  homePlayerId: z.string().min(1),
  tournament: z.string().optional(),
  surface: z.enum(['hard', 'clay', 'grass', 'carpet']).optional(),
  matchOdds: oddsSchema.optional(),
  set1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.record(z.string(), decimalOdds).optional(),
  setHandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  set1TotalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  set1HandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
})

type RatingRow = {
  player_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
  set1_recent: string
  surface_preference: string
}

const toPlayer = (row: RatingRow): PlayerOption & { set1Recent: number[], surfacePreference: Record<string, number> } => ({
  id: row.player_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.set1_count,
  lastPlayedOn: row.last_played_on,
  set1Recent: JSON.parse(row.set1_recent || '[]') as number[],
  surfacePreference: JSON.parse(row.surface_preference || '{"hard":1,"clay":1,"grass":1,"carpet":1}') as Record<string, number>,
})

const MIN_MATCH = TENNIS_MIN_MATCH_SAMPLE
const MIN_SET1 = TENNIS_MIN_SET1_SAMPLE
const MIN_CANDIDATE = 20
const MIN_EV = 0.05
const MIN_SET1_EV = 0.08
const MIN_POINTS_EV = 0.08
const DATA_LAG_DAYS = 14
const STALE_DAYS = 90

const daysBetween = (from: string, to: string) =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩位選手，確認賠率大於 1、盤口線是 .5' })
  }
  const body = parsed.data
  if (body.awayPlayerId === body.homePlayerId) {
    throw createError({ statusCode: 400, statusMessage: '請選擇兩位不同選手' })
  }

  const { sqlite } = useDb()
  const table = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tennis_model_state'`).get()
  if (!table) {
    throw createError({ statusCode: 503, statusMessage: '網球模型尚未建立，請先執行資料匯入和回測' })
  }

  const model = sqlite.prepare(`
    SELECT model_version, set1_method, payload, data_through
    FROM tennis_model_state
    WHERE discipline = ?
  `).get(body.discipline) as {
    model_version: string
    set1_method: Set1Method
    payload: string
    data_through: string
  } | undefined

  if (!model) {
    throw createError({ statusCode: 503, statusMessage: '這個項目還沒有完成回測' })
  }

  const ratingSql = `
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.set1_recent, r.surface_preference
    FROM tennis_player_ratings r
    JOIN tennis_players p ON p.player_id = r.player_id
    WHERE r.discipline = ? AND r.player_id = ?
  `
  const awayRow = sqlite.prepare(ratingSql).get(body.discipline, body.awayPlayerId) as RatingRow | undefined
  const homeRow = sqlite.prepare(ratingSql).get(body.discipline, body.homePlayerId) as RatingRow | undefined
  const missing = (id: string) => ({
    id,
    name: '找不到選手',
    elo: 1500,
    matchCount: 0,
    set1Count: 0,
    lastPlayedOn: null,
    set1Recent: [] as number[],
    surfacePreference: { hard: 1, clay: 1, grass: 1, carpet: 1 },
  })
  const away = awayRow ? toPlayer(awayRow) : missing(body.awayPlayerId)
  const home = homeRow ? toPlayer(homeRow) : missing(body.homePlayerId)
  const payload = JSON.parse(model.payload) as TennisModelPayload
  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const bestOf: TennisBestOf = tennisBestOf(body.discipline as TennisDiscipline, body.tournament ?? '')
  const scores = bestOf === 5 ? TENNIS_BO5_CORRECT_SCORES : TENNIS_BO3_CORRECT_SCORES

  const matchReady = away.matchCount >= MIN_MATCH && home.matchCount >= MIN_MATCH
  const set1Ready = away.set1Count >= MIN_SET1 && home.set1Count >= MIN_SET1
  const awayRating = effectiveRating(away.elo, away.matchCount, away.lastPlayedOn, asOf, payload.shrink?.mode ?? 'inactivity')
  const homeRating = effectiveRating(home.elo, home.matchCount, home.lastPlayedOn, asOf, payload.shrink?.mode ?? 'inactivity')
  const pMatchAway = expectedScoreWithSurface(
    awayRating,
    homeRating,
    body.surface as Surface | undefined,
    away.surfacePreference as { hard: number, clay: number, grass: number, carpet: number },
    home.surfacePreference as { hard: number, clay: number, grass: number, carpet: number },
  )
  const dataLagOk = daysBetween(model.data_through, asOf) <= DATA_LAG_DAYS
  const staleOk = [away, home].every((player) => {
    if (!player.lastPlayedOn) return true
    return daysBetween(player.lastPlayedOn, model.data_through) <= STALE_DAYS
  })
  const quality = {
    sampleOk: away.matchCount >= MIN_CANDIDATE && home.matchCount >= MIN_CANDIDATE,
    dataLagOk,
    staleOk,
    awayName: away.name,
    homeName: home.name,
  }

  const calibrateTwoWay = (probability: number, bins: TennisModelPayload['calibration'] extends infer C ? C : never) => {
    const list = (bins ?? []) as Array<{ lo: number, hi: number, predicted: number | null, actual: number | null, n: number }>
    const calibrated = calibrateProbability(probability, list)
    return [calibrated, 1 - calibrated]
  }

  const matchWinner = buildMarketQuote(matchReady ? pMatchAway : null, {
    ...quality,
    odds: body.matchOdds,
    reason: `任一方全場樣本少於 ${MIN_MATCH} 場`,
    calibration: payload.calibration?.match ?? payload.test?.match?.calibration ?? [],
    minEv: MIN_EV,
    sampleOk: quality.sampleOk,
  })

  const pSet1Away = matchProbabilityToSet1(pMatchAway, bestOf)
  const set1Winner = buildMarketQuote(set1Ready ? pSet1Away : null, {
    ...quality,
    odds: body.set1Odds,
    reason: `任一方第一盤樣本少於 ${MIN_SET1} 場`,
    calibration: payload.calibration?.set1 ?? payload.test?.set1?.calibration ?? [],
    minEv: MIN_SET1_EV,
    sampleOk: quality.sampleOk,
    isGame1: true,
  })

  const emptyPoints = (reason: string) => ({
    totalPoints: body.totalOdds ? emptyMultiMarket(reason) : null,
    pointsHandicap: body.handicapOdds ? emptyMultiMarket(reason) : null,
    correctScore: body.correctScoreOdds ? emptyMultiMarket(reason) : null,
    setHandicap: body.setHandicapOdds ? emptyMultiMarket(reason) : null,
    set1TotalPoints: body.set1TotalOdds ? emptyMultiMarket(reason) : null,
    set1PointsHandicap: body.set1HandicapOdds ? emptyMultiMarket(reason) : null,
  })

  const buildPoints = () => {
    if (!payload.rally) return emptyPoints('分數模型尚未建立')
    if (!matchReady) return emptyPoints(`任一方全場樣本少於 ${MIN_MATCH} 場`)
    const distribution = tennisMatchDistribution(
      matchProbabilityToPoint(pMatchAway, bestOf),
      payload.rally.sigma,
      bestOf,
    )

    const totalPoints = body.totalOdds
      ? buildMultiMarketQuote([
        { key: 'over', label: `大 ${body.totalOdds.line}`, probability: probabilityAbove(distribution.total, body.totalOdds.line) },
        { key: 'under', label: `小 ${body.totalOdds.line}`, probability: 1 - probabilityAbove(distribution.total, body.totalOdds.line) },
      ], {
        ...quality,
        odds: [body.totalOdds.over, body.totalOdds.under],
        calibrated: calibrateTwoWay(probabilityAbove(distribution.total, body.totalOdds.line), payload.calibration?.totals),
        line: body.totalOdds.line,
        summary: `預期總局數 ${distributionMean(distribution.total).toFixed(1)}，模型 50% 線 ${fairLine(distribution.total)}`,
        minEv: MIN_POINTS_EV,
      })
      : null

    const pointsHandicap = body.handicapOdds
      ? buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${body.handicapOdds.awayLine > 0 ? '+' : ''}${body.handicapOdds.awayLine}`, probability: coversHandicap(distribution.margin, body.handicapOdds.awayLine) },
        { key: 'home', label: `${home.name} ${-body.handicapOdds.awayLine > 0 ? '+' : ''}${-body.handicapOdds.awayLine}`, probability: 1 - coversHandicap(distribution.margin, body.handicapOdds.awayLine) },
      ], {
        ...quality,
        odds: [body.handicapOdds.away, body.handicapOdds.home],
        calibrated: calibrateTwoWay(coversHandicap(distribution.margin, body.handicapOdds.awayLine), payload.calibration?.handicap),
        line: body.handicapOdds.awayLine,
        summary: `預期局差 ${away.name} ${distributionMean(distribution.margin) > 0 ? '+' : ''}${distributionMean(distribution.margin).toFixed(1)}`,
        minEv: MIN_POINTS_EV,
      })
      : null

    const correctScore = body.correctScoreOdds
      ? buildMultiMarketQuote(
        scores.map(score => ({ key: score, label: score, probability: distribution.correctScore[score] ?? 0 })),
        {
          ...quality,
          odds: scores.map(score => body.correctScoreOdds?.[score] ?? 2),
          calibrated: scores.map(score => calibrateProbability(distribution.correctScore[score] ?? 0, payload.calibration?.correctScore ?? [])),
          summary: bestOf === 5 ? '五盤三勝，比數為客:主' : '三盤兩勝，比數為客:主',
          minEv: MIN_POINTS_EV,
        },
      )
      : null

    const setHandicap = body.setHandicapOdds
      ? buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${body.setHandicapOdds.awayLine > 0 ? '+' : ''}${body.setHandicapOdds.awayLine}`, probability: coversHandicap(distribution.setMargin, body.setHandicapOdds.awayLine) },
        { key: 'home', label: `${home.name} ${-body.setHandicapOdds.awayLine > 0 ? '+' : ''}${-body.setHandicapOdds.awayLine}`, probability: 1 - coversHandicap(distribution.setMargin, body.setHandicapOdds.awayLine) },
      ], {
        ...quality,
        odds: [body.setHandicapOdds.away, body.setHandicapOdds.home],
        calibrated: calibrateTwoWay(coversHandicap(distribution.setMargin, body.setHandicapOdds.awayLine), undefined),
        line: body.setHandicapOdds.awayLine,
        summary: '盤數讓分',
        minEv: MIN_POINTS_EV,
      })
      : null

    const set1TotalPoints = body.set1TotalOdds
      ? buildMultiMarketQuote([
        { key: 'over', label: `大 ${body.set1TotalOdds.line}`, probability: probabilityAbove(distribution.set1Total, body.set1TotalOdds.line) },
        { key: 'under', label: `小 ${body.set1TotalOdds.line}`, probability: 1 - probabilityAbove(distribution.set1Total, body.set1TotalOdds.line) },
      ], {
        ...quality,
        odds: [body.set1TotalOdds.over, body.set1TotalOdds.under],
        calibrated: calibrateTwoWay(probabilityAbove(distribution.set1Total, body.set1TotalOdds.line), undefined),
        line: body.set1TotalOdds.line,
        summary: `第一盤預期總局數 ${distributionMean(distribution.set1Total).toFixed(1)}`,
        minEv: MIN_POINTS_EV,
      })
      : null

    const set1PointsHandicap = body.set1HandicapOdds
      ? buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${body.set1HandicapOdds.awayLine > 0 ? '+' : ''}${body.set1HandicapOdds.awayLine}`, probability: coversHandicap(distribution.set1Margin, body.set1HandicapOdds.awayLine) },
        { key: 'home', label: `${home.name} ${-body.set1HandicapOdds.awayLine > 0 ? '+' : ''}${-body.set1HandicapOdds.awayLine}`, probability: 1 - coversHandicap(distribution.set1Margin, body.set1HandicapOdds.awayLine) },
      ], {
        ...quality,
        odds: [body.set1HandicapOdds.away, body.set1HandicapOdds.home],
        calibrated: calibrateTwoWay(coversHandicap(distribution.set1Margin, body.set1HandicapOdds.awayLine), undefined),
        line: body.set1HandicapOdds.awayLine,
        summary: '第一盤讓局',
        minEv: MIN_POINTS_EV,
      })
      : null

    return { totalPoints, pointsHandicap, correctScore, setHandicap, set1TotalPoints, set1PointsHandicap }
  }

  const warnings: string[] = []
  if (!dataLagOk) warnings.push(`資料截至 ${model.data_through}，距報價日已超過 ${DATA_LAG_DAYS} 天`)
  if (!staleOk) warnings.push('有選手超過 90 天未出賽，評分較不確定')
  if (body.surface) warnings.push(`已套用 ${body.surface} 場地調整`)
  if (bestOf === 5) warnings.push('本場依大滿貫男單以五盤三勝估計')

  if (!awayRow || !homeRow) {
    const reason = '選手不在這個項目的資料裡'
    return {
      sport: 'tennis',
      discipline: body.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
      asOf,
      shrinkEnabled: payload.shrink?.enabled ?? false,
      sourceUrl: TENNIS_SOURCE_URL,
      away,
      home,
      isHome: false,
      warnings: [reason],
      matchWinner: emptyMarket(reason),
      set1Winner: emptyMarket(reason),
      ...emptyPoints(reason),
    } satisfies QuoteResponse
  }

  const points = buildPoints()
  const response: QuoteResponse = {
    sport: 'tennis',
    discipline: body.discipline,
    modelVersion: model.model_version,
    set1Method: model.set1_method,
    dataThrough: model.data_through,
    asOf,
    shrinkEnabled: payload.shrink?.enabled ?? false,
    sourceUrl: TENNIS_SOURCE_URL,
    away,
    home,
    isHome: false,
    warnings,
    matchWinner,
    set1Winner,
    ...points,
  }
  return response
})
