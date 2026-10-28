import { z } from 'zod'
import type { Set1Method, TeamOption, QuoteResponse, VolleyballDiscipline } from '../../../shared/types'
import { VOLLEYBALL_SOURCE_URL, VOLLEYBALL_MIN_MATCH_SAMPLE, VOLLEYBALL_MIN_SET1_SAMPLE } from '../../models/constants'
import {
  isHalfLine,
  calibrateProbability,
  MIN_CANDIDATE_EV,
  MIN_GAME1_CANDIDATE_EV,
  MIN_POINTS_CANDIDATE_EV,
  MIN_CANDIDATE_SAMPLE,
} from '../../../shared/decision'
import { daysBetween } from '../../models/eloCore'
import { buildMarketQuote, buildMultiMarketQuote, emptyMarket, emptyMultiMarket } from '../../models/quote'
import {
  volleyballMatchDistribution,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  volleyballSetCount,
  probabilityAbove,
  distributionMean,
  coversHandicap,
  fairLine,
} from '../../models/volleyballRally'
import { expectedScoreWithFactors, effectiveRating, venueModeForQuote, type ShrinkMode } from '../../models/volleyballElo'
import { VOLLEYBALL_CORRECT_SCORES } from '../../../shared/types'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)

const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

const bodySchema = z.object({
  discipline: z.enum(['M', 'W']),
  awayTeamId: z.string().min(1),
  homeTeamId: z.string().min(1),
  isHome: z.boolean().default(false),
  tournament: z.string().optional(),
  matchOdds: oddsSchema.optional(),
  set1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.object({
    '3:0': decimalOdds,
    '3:1': decimalOdds,
    '3:2': decimalOdds,
    '2:3': decimalOdds,
    '1:3': decimalOdds,
    '0:3': decimalOdds,
  }).optional(),
  setHandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  set1TotalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  set1HandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  setCountOdds: z.record(z.string(), decimalOdds).optional(),
})

type RatingRow = {
  team_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
  home_advantage: number
  roster_strength: number
  set1_recent: string
}

const toTeam = (row: RatingRow): TeamOption & { set1Recent: number[] } => ({
  id: row.team_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.set1_count,
  lastPlayedOn: row.last_played_on,
  homeAdvantage: row.home_advantage,
  rosterStrength: row.roster_strength,
  set1Recent: JSON.parse(row.set1_recent || '[]') as number[],
})

const DATA_LAG_DAYS = 7
const STALE_TEAM_DAYS = 180

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩支球隊，確認賠率大於 1、盤口線是 .5' })
  }

  const body = parsed.data
  if (body.awayTeamId === body.homeTeamId) {
    throw createError({ statusCode: 400, statusMessage: '請選擇兩支不同球隊' })
  }

  const { sqlite } = useDb()

  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_model_state'
  `).get()

  if (!tableExists) {
    throw createError({ statusCode: 503, statusMessage: '排球模型尚未建立，請先執行資料匯入和回測' })
  }

  const model = sqlite.prepare(`
    SELECT model_version, set1_method, payload, data_through
    FROM volleyball_model_state
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
    SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on,
           r.home_advantage, r.roster_strength, r.set1_recent
    FROM volleyball_team_ratings r
    JOIN volleyball_teams t ON t.team_id = r.team_id
    WHERE r.discipline = ? AND r.team_id = ?
  `
  const awayRow = sqlite.prepare(ratingSql).get(body.discipline, body.awayTeamId) as RatingRow | undefined
  const homeRow = sqlite.prepare(ratingSql).get(body.discipline, body.homeTeamId) as RatingRow | undefined

  if (!awayRow || !homeRow) {
    const reason = '球隊不在這個項目的資料裡'
    const empty = (id: string): TeamOption & { set1Recent: number[] } => ({
      id,
      name: '找不到球隊',
      elo: 1500,
      matchCount: 0,
      set1Count: 0,
      lastPlayedOn: null,
      homeAdvantage: 0,
      rosterStrength: 1.0,
      set1Recent: [],
    })
    const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    const response: QuoteResponse = {
      sport: 'volleyball',
      discipline: body.discipline,
      modelVersion: model.model_version,
      set1Method: model.set1_method,
      dataThrough: model.data_through,
      asOf,
      shrinkEnabled: false,
      sourceUrl: VOLLEYBALL_SOURCE_URL,
      away: awayRow ? toTeam(awayRow) : empty(body.awayTeamId),
      home: homeRow ? toTeam(homeRow) : empty(body.homeTeamId),
      isHome: body.isHome,
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

  const away = toTeam(awayRow)
  const home = toTeam(homeRow)
  const payload = JSON.parse(model.payload) as {
    rally?: { coefficients: [number, number], sigma: number, tau?: number }
    shrink?: { mode?: ShrinkMode }
    calibration?: {
      match?: Array<{ predicted: number | null, actual: number | null }>
      set1?: Array<{ predicted: number | null, actual: number | null }>
    }
  }
  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

  const matchReady = away.matchCount >= VOLLEYBALL_MIN_MATCH_SAMPLE && home.matchCount >= VOLLEYBALL_MIN_MATCH_SAMPLE
  const set1Ready = away.set1Count >= VOLLEYBALL_MIN_SET1_SAMPLE && home.set1Count >= VOLLEYBALL_MIN_SET1_SAMPLE
  const shrinkMode: ShrinkMode = payload.shrink?.mode === 'raw' ? 'raw' : 'inactivity'

  const awayRating = effectiveRating(away.elo, away.matchCount, away.lastPlayedOn, asOf, shrinkMode)
  const homeRating = effectiveRating(home.elo, home.matchCount, home.lastPlayedOn, asOf, shrinkMode)

  const venueMode = venueModeForQuote(body.isHome, body.tournament ?? '')
  const pMatchAway = expectedScoreWithFactors(
    awayRating,
    homeRating,
    false,
    venueMode,
    away.rosterStrength,
    home.rosterStrength,
  )

  const dataLagOk = daysBetween(model.data_through, asOf) <= DATA_LAG_DAYS
  const staleOk = [away, home].every((team) => {
    if (!team.lastPlayedOn) return true
    return daysBetween(team.lastPlayedOn, model.data_through) <= STALE_TEAM_DAYS
  })

  const matchSampleOk = away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE
  const set1SampleOk = away.set1Count >= MIN_CANDIDATE_SAMPLE && home.set1Count >= MIN_CANDIDATE_SAMPLE
  const quality = {
    sampleOk: matchSampleOk,
    dataLagOk,
    staleOk,
    awayName: away.name,
    homeName: home.name,
  }

  const calibrateTwoWay = (probability: number, bins: Array<{ predicted: number | null, actual: number | null }> = []) => {
    const calibrated = calibrateProbability(probability, bins)
    return [calibrated, 1 - calibrated]
  }

  const calibrateMultiWay = (probabilities: number[], bins: Array<{ predicted: number | null, actual: number | null }> = []) => {
    const calibrated = probabilities.map(p => calibrateProbability(p, bins))
    const sum = calibrated.reduce((s, v) => s + v, 0)
    return calibrated.map(v => v / sum)
  }

  const matchWinner = buildMarketQuote(matchReady ? pMatchAway : null, {
    ...quality,
    odds: body.matchOdds,
    reason: `任一方全場樣本少於 ${VOLLEYBALL_MIN_MATCH_SAMPLE} 場`,
    calibration: payload.calibration?.match ?? [],
    minEv: MIN_CANDIDATE_EV,
    sampleOk: quality.sampleOk,
  })

  const pSet1Away = matchProbabilityToSet1(pMatchAway, payload.rally?.sigma ?? 0)
  const set1Winner = buildMarketQuote(set1Ready ? pSet1Away : null, {
    ...quality,
    odds: body.set1Odds,
    reason: `任一方第一盤樣本少於 ${VOLLEYBALL_MIN_SET1_SAMPLE} 場`,
    calibration: payload.calibration?.set1 ?? [],
    minEv: MIN_GAME1_CANDIDATE_EV,
    sampleOk: set1SampleOk,
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
    if (!payload.rally) return emptyPoints('分數模型尚未建立')
    if (!matchReady) return emptyPoints(`任一方全場樣本少於 ${VOLLEYBALL_MIN_MATCH_SAMPLE} 場`)

    const distribution = volleyballMatchDistribution(
      matchProbabilityToPoint(pMatchAway, payload.rally.sigma),
      payload.rally.sigma,
      payload.rally.tau ?? 0,
    )

    let totalPoints = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.totalOdds) {
      const { line } = body.totalOdds
      const pOver = probabilityAbove(distribution.total, line)
      totalPoints = buildMultiMarketQuote([
        { key: 'over', label: `大 ${line}`, probability: pOver },
        { key: 'under', label: `小 ${line}`, probability: 1 - pOver },
      ], {
        ...quality,
        odds: [body.totalOdds.over, body.totalOdds.under],
        calibrated: calibrateTwoWay(pOver),
        line,
        summary: `預期總分 ${distributionMean(distribution.total).toFixed(1)}，模型 50% 線 ${fairLine(distribution.total)}`,
        minEv: MIN_POINTS_CANDIDATE_EV,
      })
    }

    let pointsHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.handicapOdds) {
      const { awayLine } = body.handicapOdds
      const pAwayCovers = coversHandicap(distribution.margin, awayLine)
      pointsHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${awayLine > 0 ? '+' : ''}${awayLine}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${-awayLine > 0 ? '+' : ''}${-awayLine}`, probability: 1 - pAwayCovers },
      ], {
        ...quality,
        odds: [body.handicapOdds.away, body.handicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: `預期分差 ${away.name} ${distributionMean(distribution.margin) > 0 ? '+' : ''}${distributionMean(distribution.margin).toFixed(1)}`,
        minEv: MIN_POINTS_CANDIDATE_EV,
      })
    }

    let correctScore = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.correctScoreOdds) {
      const probs = VOLLEYBALL_CORRECT_SCORES.map(score => distribution.correctScore[score])
      correctScore = buildMultiMarketQuote(
        VOLLEYBALL_CORRECT_SCORES.map((score, i) => ({ key: score, label: score, probability: probs[i] ?? 0 })),
        {
          ...quality,
          odds: VOLLEYBALL_CORRECT_SCORES.map(score => body.correctScoreOdds![score]),
          calibrated: calibrateMultiWay(probs),
          summary: '比數為客:主',
          minEv: MIN_POINTS_CANDIDATE_EV,
        },
      )
    }

    let setHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.setHandicapOdds) {
      const { awayLine } = body.setHandicapOdds
      const pAwayCovers = coversHandicap(distribution.setMargin, awayLine)
      setHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${awayLine > 0 ? '+' : ''}${awayLine}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${-awayLine > 0 ? '+' : ''}${-awayLine}`, probability: 1 - pAwayCovers },
      ], {
        ...quality,
        odds: [body.setHandicapOdds.away, body.setHandicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: '局數讓分',
        minEv: MIN_POINTS_CANDIDATE_EV,
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
        ...quality,
        odds: [body.set1TotalOdds.over, body.set1TotalOdds.under],
        calibrated: calibrateTwoWay(pOver),
        line,
        summary: `第一盤預期總分 ${distributionMean(distribution.set1Total).toFixed(1)}`,
        minEv: MIN_POINTS_CANDIDATE_EV,
      })
    }

    let set1PointsHandicap = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.set1HandicapOdds) {
      const { awayLine } = body.set1HandicapOdds
      const pAwayCovers = coversHandicap(distribution.set1Margin, awayLine)
      set1PointsHandicap = buildMultiMarketQuote([
        { key: 'away', label: `${away.name} ${awayLine > 0 ? '+' : ''}${awayLine}`, probability: pAwayCovers },
        { key: 'home', label: `${home.name} ${-awayLine > 0 ? '+' : ''}${-awayLine}`, probability: 1 - pAwayCovers },
      ], {
        ...quality,
        odds: [body.set1HandicapOdds.away, body.set1HandicapOdds.home],
        calibrated: calibrateTwoWay(pAwayCovers),
        line: awayLine,
        summary: '第一盤讓分',
        minEv: MIN_POINTS_CANDIDATE_EV,
      })
    }

    let setCount = null as ReturnType<typeof buildMultiMarketQuote> | null
    if (body.setCountOdds) {
      const counts = volleyballSetCount(distribution.correctScore)
      const keys = Object.keys(body.setCountOdds).sort()
      setCount = buildMultiMarketQuote(
        keys.map(key => ({ key, label: `${key} 局`, probability: counts[key as '3' | '4' | '5'] ?? 0 })),
        {
          ...quality,
          odds: keys.map(key => body.setCountOdds![key] ?? 0),
          calibrated: calibrateMultiWay(keys.map(key => counts[key as '3' | '4' | '5'] ?? 0)),
          summary: '正確總局數',
          minEv: MIN_POINTS_CANDIDATE_EV,
        },
      )
    }

    return { totalPoints, pointsHandicap, correctScore, setHandicap, set1TotalPoints, set1PointsHandicap, setCount }
  }

  const points = buildPointsMarkets()

  const warnings: string[] = []
  if (!dataLagOk) {
    warnings.push(`資料截至 ${model.data_through}，距報價日已超過 ${DATA_LAG_DAYS} 天`)
  }
  if (!staleOk) {
    warnings.push('有球隊超過半年未出賽，評分較不確定')
  }
  if (!matchSampleOk) {
    warnings.push('排球歷史只含運彩有開盤的場次，樣本遠少於羽球，這場只適合作對照')
  }

  const response: QuoteResponse = {
    sport: 'volleyball',
    discipline: body.discipline,
    modelVersion: model.model_version,
    set1Method: model.set1_method,
    dataThrough: model.data_through,
    asOf,
    shrinkEnabled: shrinkMode !== 'raw',
    sourceUrl: VOLLEYBALL_SOURCE_URL,
    away,
    home,
    isHome: body.isHome,
    warnings,
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
