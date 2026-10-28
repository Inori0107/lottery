import { z } from 'zod'
import type { PlayerOption, QuoteResponse, Set1Method } from '../../../shared/types'
import {
  MIN_CANDIDATE_EV,
  MIN_CANDIDATE_SAMPLE,
  MIN_GAME1_CANDIDATE_EV,
  MIN_POINTS_CANDIDATE_EV,
  isHalfLine,
} from '../../../shared/decision'
import { tennisBestOf, tennisCorrectScores } from '../../../shared/sports'
import {
  DATA_LAG_DAYS,
  STALE_PLAYER_DAYS,
  TENNIS_MIN_MATCH_SAMPLE,
  TENNIS_MIN_SET1_SAMPLE,
  TENNIS_SOURCE_URL,
} from '../../models/constants'
import { daysBetween } from '../../models/eloCore'
import {
  buildMarketQuote,
  buildMultiMarketQuote,
  buildQuoteWarnings,
  calibrateMultiWay,
  calibrateTwoWay,
  emptyMarket,
  emptyMultiMarket,
} from '../../models/quote'
import { effectiveRating, expectedScore, type ShrinkMode } from '../../models/tennisElo'
import {
  coversHandicap,
  distributionMean,
  fairLine,
  isGrandSlamDeciding,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  probabilityAbove,
  tennisMatchDistribution,
  tennisSetCount,
} from '../../models/tennisRally'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)
const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

const bodySchema = z.object({
  discipline: z.enum(['ATP', 'WTA']),
  awayPlayerId: z.string().min(1),
  homePlayerId: z.string().min(1),
  tournament: z.string().optional(),
  matchOdds: oddsSchema.optional(),
  set1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.record(z.string(), decimalOdds).optional(),
  setHandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
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
}

const toPlayer = (row: RatingRow): PlayerOption => ({
  id: row.player_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.set1_count,
  lastPlayedOn: row.last_played_on,
})

const signed = (line: number) => (line > 0 ? `+${line}` : `${line}`)

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
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on
    FROM tennis_player_ratings r
    JOIN tennis_players p ON p.player_id = r.player_id
    WHERE r.discipline = ? AND r.player_id = ?
  `
  const otherDiscipline = body.discipline === 'ATP' ? 'WTA' : 'ATP'
  const ratingLookup = sqlite.prepare(ratingSql)
  const tennisRating = (playerId: string) =>
    (ratingLookup.get(body.discipline, playerId) ?? ratingLookup.get(otherDiscipline, playerId)) as RatingRow | undefined
  const awayRow = tennisRating(body.awayPlayerId)
  const homeRow = tennisRating(body.homePlayerId)
  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const missing = (id: string): PlayerOption => ({
    id,
    name: '找不到選手',
    elo: 1500,
    matchCount: 0,
    set1Count: 0,
    lastPlayedOn: null,
  })

  if (!awayRow || !homeRow) {
    const reason = '選手不在這個項目的資料裡'
    const response: QuoteResponse = {
      sport: 'tennis',
      discipline: body.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
      asOf,
      shrinkEnabled: false,
      sourceUrl: TENNIS_SOURCE_URL,
      away: awayRow ? toPlayer(awayRow) : missing(body.awayPlayerId),
      home: homeRow ? toPlayer(homeRow) : missing(body.homePlayerId),
      isHome: false,
      warnings: [reason],
      matchWinner: emptyMarket(reason),
      set1Winner: emptyMarket(reason),
      totalPoints: body.totalOdds ? emptyMultiMarket(reason) : null,
      pointsHandicap: body.handicapOdds ? emptyMultiMarket(reason) : null,
      correctScore: body.correctScoreOdds ? emptyMultiMarket(reason) : null,
      setHandicap: body.setHandicapOdds ? emptyMultiMarket(reason) : null,
      set1TotalPoints: body.set1TotalOdds ? emptyMultiMarket(reason) : null,
      set1PointsHandicap: body.set1HandicapOdds ? emptyMultiMarket(reason) : null,
      setCount: body.setCountOdds ? emptyMultiMarket(reason) : null,
    }
    return response
  }

  const away = toPlayer(awayRow)
  const home = toPlayer(homeRow)
  const payload = JSON.parse(model.payload) as {
    shrink?: { mode?: ShrinkMode }
    calibration?: {
      match?: Array<{ lo: number, hi: number, n: number, predicted: number | null, actual: number | null }>
      set1?: Array<{ lo: number, hi: number, n: number, predicted: number | null, actual: number | null }>
    }
  }
  const shrinkMode: ShrinkMode = payload.shrink?.mode === 'raw' ? 'raw' : 'inactivity'
  const awayRating = effectiveRating(away.elo, away.matchCount, away.lastPlayedOn, asOf, shrinkMode)
  const homeRating = effectiveRating(home.elo, home.matchCount, home.lastPlayedOn, asOf, shrinkMode)
  const pMatchAway = expectedScore(awayRating, homeRating)
  const tournament = body.tournament ?? ''
  const bestOf = tennisBestOf(tournament, body.discipline)
  const matchReady = away.matchCount >= TENNIS_MIN_MATCH_SAMPLE && home.matchCount >= TENNIS_MIN_MATCH_SAMPLE
  const set1Ready = away.set1Count >= TENNIS_MIN_SET1_SAMPLE && home.set1Count >= TENNIS_MIN_SET1_SAMPLE
  const dataLagOk = daysBetween(model.data_through, asOf) <= DATA_LAG_DAYS
  const staleOk = [away, home].every((player) => {
    if (!player.lastPlayedOn) return true
    return daysBetween(player.lastPlayedOn, model.data_through) <= STALE_PLAYER_DAYS
  })
  const quality = {
    sampleOk: away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE,
    dataLagOk,
    staleOk,
    awayName: away.name,
    homeName: home.name,
  }

  const matchWinner = buildMarketQuote(matchReady ? pMatchAway : null, {
    ...quality,
    odds: body.matchOdds,
    reason: `任一方全場樣本少於 ${TENNIS_MIN_MATCH_SAMPLE} 場`,
    calibration: payload.calibration?.match ?? [],
    minEv: MIN_CANDIDATE_EV,
  })
  const pSet1Away = matchProbabilityToSet1(pMatchAway, bestOf)
  const set1Winner = buildMarketQuote(set1Ready ? pSet1Away : null, {
    ...quality,
    odds: body.set1Odds,
    reason: `任一方第一盤樣本少於 ${TENNIS_MIN_SET1_SAMPLE} 場`,
    calibration: payload.calibration?.set1 ?? [],
    minEv: MIN_GAME1_CANDIDATE_EV,
    sampleOk: away.set1Count >= MIN_CANDIDATE_SAMPLE && home.set1Count >= MIN_CANDIDATE_SAMPLE,
    isGame1: true,
  })

  const emptyPoints = (reason: string) => ({
    totalPoints: body.totalOdds ? emptyMultiMarket(reason) : null,
    pointsHandicap: body.handicapOdds ? emptyMultiMarket(reason) : null,
    correctScore: body.correctScoreOdds ? emptyMultiMarket(reason) : null,
    setHandicap: body.setHandicapOdds ? emptyMultiMarket(reason) : null,
    set1TotalPoints: body.set1TotalOdds ? emptyMultiMarket(reason) : null,
    set1PointsHandicap: body.set1HandicapOdds ? emptyMultiMarket(reason) : null,
    setCount: body.setCountOdds ? emptyMultiMarket(reason) : null,
  })

  const buildPointsMarkets = () => {
    if (!matchReady) return emptyPoints(`任一方全場樣本少於 ${TENNIS_MIN_MATCH_SAMPLE} 場`)
    const distribution = tennisMatchDistribution(
      matchProbabilityToPoint(pMatchAway, bestOf),
      bestOf,
      isGrandSlamDeciding(tournament, bestOf),
    )
    const scoreKeys = tennisCorrectScores(bestOf)
    const pointsQuality = { ...quality, allowCandidate: false as const, minEv: MIN_POINTS_CANDIDATE_EV }

    let totalPoints = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.totalOdds) {
      const { line } = body.totalOdds
      const pOver = probabilityAbove(distribution.total, line)
      totalPoints = buildMultiMarketQuote([
        { key: 'over', label: `大 ${line}`, probability: pOver },
        { key: 'under', label: `小 ${line}`, probability: 1 - pOver },
      ], {
        ...pointsQuality,
        odds: [body.totalOdds.over, body.totalOdds.under],
        calibrated: calibrateTwoWay(pOver),
        line,
        summary: `預期總局數 ${distributionMean(distribution.total).toFixed(1)}，模型 50% 線 ${fairLine(distribution.total)}`,
      })
    }

    let pointsHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.handicapOdds) {
      const { awayLine } = body.handicapOdds
      const pAwayCovers = coversHandicap(distribution.margin, awayLine)
      pointsHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${signed(awayLine)}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${signed(-awayLine)}`, probability: 1 - pAwayCovers },
      ], {
        ...pointsQuality,
        odds: [body.handicapOdds.away, body.handicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: `預期局差 ${away.name} ${signed(Number(distributionMean(distribution.margin).toFixed(1)))}`,
      })
    }

    let correctScore = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.correctScoreOdds) {
      const keys = scoreKeys.filter(score => body.correctScoreOdds?.[score] !== undefined)
      const probs = keys.map(score => distribution.correctScore[score] ?? 0)
      correctScore = buildMultiMarketQuote(
        keys.map((score, index) => ({ key: score, label: score, probability: probs[index] ?? 0 })),
        {
          ...pointsQuality,
          odds: keys.map(score => body.correctScoreOdds![score] ?? 0),
          calibrated: calibrateMultiWay(probs),
          summary: `正確盤數為客:主（${bestOf === 5 ? '五盤' : '三盤'}）`,
        },
      )
    }

    let setHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.setHandicapOdds) {
      const { awayLine } = body.setHandicapOdds
      const pAwayCovers = coversHandicap(distribution.setMargin, awayLine)
      setHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${signed(awayLine)}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${signed(-awayLine)}`, probability: 1 - pAwayCovers },
      ], {
        ...pointsQuality,
        odds: [body.setHandicapOdds.away, body.setHandicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: '讓盤（盤數讓分）',
      })
    }

    let set1TotalPoints = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.set1TotalOdds) {
      const { line } = body.set1TotalOdds
      const pOver = probabilityAbove(distribution.set1Total, line)
      set1TotalPoints = buildMultiMarketQuote([
        { key: 'over', label: `大 ${line}`, probability: pOver },
        { key: 'under', label: `小 ${line}`, probability: 1 - pOver },
      ], {
        ...pointsQuality,
        odds: [body.set1TotalOdds.over, body.set1TotalOdds.under],
        calibrated: calibrateTwoWay(pOver),
        line,
        summary: `第 1 盤預期總局數 ${distributionMean(distribution.set1Total).toFixed(1)}`,
      })
    }

    let set1PointsHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.set1HandicapOdds) {
      const { awayLine } = body.set1HandicapOdds
      const pAwayCovers = coversHandicap(distribution.set1Margin, awayLine)
      set1PointsHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${signed(awayLine)}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${signed(-awayLine)}`, probability: 1 - pAwayCovers },
      ], {
        ...pointsQuality,
        odds: [body.set1HandicapOdds.away, body.set1HandicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: '第 1 盤讓局',
      })
    }

    let setCount = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.setCountOdds) {
      const counts = tennisSetCount(distribution.correctScore, bestOf)
      const keys = Object.keys(body.setCountOdds).sort()
      setCount = buildMultiMarketQuote(
        keys.map(key => ({ key, label: `${key} 盤`, probability: counts[key as keyof typeof counts] ?? 0 })),
        {
          ...pointsQuality,
          odds: keys.map(key => body.setCountOdds![key] ?? 0),
          calibrated: calibrateMultiWay(keys.map(key => counts[key as keyof typeof counts] ?? 0)),
          summary: '正確總盤數（打了幾盤）',
        },
      )
    }

    return { totalPoints, pointsHandicap, correctScore, setHandicap, set1TotalPoints, set1PointsHandicap, setCount }
  }

  const points = buildPointsMarkets()
  const response: QuoteResponse = {
    sport: 'tennis',
    discipline: body.discipline,
    modelVersion: model.model_version,
    set1Method: model.set1_method,
    dataThrough: model.data_through,
    asOf,
    shrinkEnabled: shrinkMode !== 'raw',
    sourceUrl: TENNIS_SOURCE_URL,
    away,
    home,
    isHome: false,
    warnings: [
      ...buildQuoteWarnings(away, home, asOf, model.data_through, shrinkMode !== 'raw'),
      `本場以 ${bestOf === 5 ? '五盤（先贏 3 盤）' : '三盤（先贏 2 盤）'} 估計。`,
    ],
    matchWinner,
    set1Winner,
    totalPoints: points.totalPoints,
    pointsHandicap: points.pointsHandicap,
    correctScore: points.correctScore,
    setHandicap: points.setHandicap,
    set1TotalPoints: points.set1TotalPoints,
    set1PointsHandicap: points.set1PointsHandicap,
    setCount: points.setCount,
  }
  return response
})
