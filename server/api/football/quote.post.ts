import { z } from 'zod'
import type { TeamOption, QuoteResponse, FootballDiscipline, Market1X2Quote, MultiMarketQuote } from '../../../shared/types'
import { FOOTBALL_SOURCE_URL, FOOTBALL_MIN_MATCH_SAMPLE } from '../../models/constants'
import { isHalfLine, MIN_CANDIDATE_EV, MIN_POINTS_CANDIDATE_EV, MIN_CANDIDATE_SAMPLE } from '../../../shared/decision'
import { daysBetween } from '../../models/eloCore'
import { effectiveRating, venueModeForQuote, type ShrinkMode } from '../../models/footballElo'
import {
  computeScoreDistribution,
  expectedGoalsFromElo,
  totalGoalsProbability,
  handicapProbability,
  impliedProbabilitiesFrom1X2Odds,
  firstHalfScoreDistribution,
} from '../../models/footballGoals'
import { devigMultiWay } from '../../models/odds'

const decimalOdds = z.number().gt(1)

const bodySchema = z.object({
  discipline: z.enum(['FM', 'FW']),
  awayTeamId: z.string().min(1),
  homeTeamId: z.string().min(1),
  isHome: z.boolean().default(true),
  tournament: z.string().optional(),
  match1X2Odds: z.object({ home: decimalOdds, draw: decimalOdds, away: decimalOdds }).optional(),
  totalOdds: z.object({ line: z.number().positive(), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ homeLine: z.number(), away: decimalOdds, home: decimalOdds }).optional(),
  firstHalf1X2Odds: z.object({ home: decimalOdds, draw: decimalOdds, away: decimalOdds }).optional(),
  firstHalfTotalOdds: z.object({ line: z.number().positive(), over: decimalOdds, under: decimalOdds }).optional(),
  firstHalfHandicapOdds: z.object({ homeLine: z.number(), away: decimalOdds, home: decimalOdds }).optional(),
})

type TeamRatingRow = {
  team_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
  home_advantage: number
}

const toTeam = (row: TeamRatingRow): TeamOption => ({
  id: row.team_id,
  name: row.name_primary,
  elo: row.elo,
  matchCount: row.match_count,
  set1Count: row.set1_count,
  lastPlayedOn: row.last_played_on,
  homeAdvantage: row.home_advantage,
  rosterStrength: 1.0,
})

const DATA_LAG_DAYS = 14
const STALE_TEAM_DAYS = 180

const empty1X2Market = (reason: string): Market1X2Quote => ({
  status: 'insufficient',
  reason,
  probabilityHome: null,
  probabilityDraw: null,
  probabilityAway: null,
  probabilityCalibratedHome: null,
  probabilityCalibratedDraw: null,
  probabilityCalibratedAway: null,
  impliedHome: null,
  impliedDraw: null,
  impliedAway: null,
  marketHome: null,
  marketDraw: null,
  marketAway: null,
  evHome: null,
  evDraw: null,
  evAway: null,
  decision: { action: 'pass', outcome: null, reason },
})

const emptyMultiMarket = (reason: string): MultiMarketQuote => ({
  status: 'insufficient',
  reason,
  line: null,
  summary: null,
  outcomes: [],
  decision: { action: 'pass', outcomeKey: null, reason },
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩支球隊，確認賠率大於 1' })
  }

  const body = parsed.data
  if (body.awayTeamId === body.homeTeamId) {
    throw createError({ statusCode: 400, statusMessage: '請選擇兩支不同球隊' })
  }

  const { sqlite } = useDb()

  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='football_team_ratings'
  `).get()

  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const insufficientReason = '足球模型尚未完成建立，目前只顯示盤口去水機率'

  const emptyTeam = (id: string): TeamOption => ({
    id,
    name: '找不到球隊',
    elo: 1500,
    matchCount: 0,
    set1Count: 0,
    lastPlayedOn: null,
    homeAdvantage: 0,
    rosterStrength: 1.0,
  })

  if (!tableExists) {
    const buildMarketOnlyResponse = (): QuoteResponse => {
      const away = emptyTeam(body.awayTeamId)
      const home = emptyTeam(body.homeTeamId)

      let match1X2: Market1X2Quote | null = null
      if (body.match1X2Odds) {
        const implied = impliedProbabilitiesFrom1X2Odds(
          body.match1X2Odds.home,
          body.match1X2Odds.draw,
          body.match1X2Odds.away
        )
        match1X2 = {
          status: 'insufficient',
          reason: insufficientReason,
          probabilityHome: null,
          probabilityDraw: null,
          probabilityAway: null,
          probabilityCalibratedHome: null,
          probabilityCalibratedDraw: null,
          probabilityCalibratedAway: null,
          impliedHome: 1 / body.match1X2Odds.home,
          impliedDraw: 1 / body.match1X2Odds.draw,
          impliedAway: 1 / body.match1X2Odds.away,
          marketHome: implied.home,
          marketDraw: implied.draw,
          marketAway: implied.away,
          evHome: null,
          evDraw: null,
          evAway: null,
          decision: { action: 'pass', outcome: null, reason: insufficientReason },
        }
      }

      let totalGoals: MultiMarketQuote | null = null
      if (body.totalOdds) {
        const implied = devigMultiWay([body.totalOdds.over, body.totalOdds.under])
        totalGoals = {
          status: 'insufficient',
          reason: insufficientReason,
          line: body.totalOdds.line,
          summary: `盤口 ${body.totalOdds.line}`,
          outcomes: [
            { key: 'over', label: `大 ${body.totalOdds.line}`, odds: body.totalOdds.over, probability: 0, probabilityCalibrated: 0, implied: 1 / body.totalOdds.over, market: implied[0] ?? null, ev: null },
            { key: 'under', label: `小 ${body.totalOdds.line}`, odds: body.totalOdds.under, probability: 0, probabilityCalibrated: 0, implied: 1 / body.totalOdds.under, market: implied[1] ?? null, ev: null },
          ],
          decision: { action: 'pass', outcomeKey: null, reason: insufficientReason },
        }
      }

      let goalsHandicap: MultiMarketQuote | null = null
      if (body.handicapOdds) {
        const implied = devigMultiWay([body.handicapOdds.away, body.handicapOdds.home])
        const awayLine = -body.handicapOdds.homeLine
        goalsHandicap = {
          status: 'insufficient',
          reason: insufficientReason,
          line: awayLine,
          summary: `讓球 ${awayLine > 0 ? '+' : ''}${awayLine}`,
          outcomes: [
            { key: 'away', label: `客 ${awayLine > 0 ? '+' : ''}${awayLine}`, odds: body.handicapOdds.away, probability: 0, probabilityCalibrated: 0, implied: 1 / body.handicapOdds.away, market: implied[0] ?? null, ev: null },
            { key: 'home', label: `主 ${-awayLine > 0 ? '+' : ''}${-awayLine}`, odds: body.handicapOdds.home, probability: 0, probabilityCalibrated: 0, implied: 1 / body.handicapOdds.home, market: implied[1] ?? null, ev: null },
          ],
          decision: { action: 'pass', outcomeKey: null, reason: insufficientReason },
        }
      }

      return {
        sport: 'football',
        discipline: body.discipline,
        modelVersion: 'market-only-v1',
        set1Method: 'logistic',
        dataThrough: asOf,
        asOf,
        shrinkEnabled: false,
        sourceUrl: FOOTBALL_SOURCE_URL,
        away,
        home,
        isHome: body.isHome,
        warnings: [insufficientReason],
        matchWinner: { status: 'insufficient', reason: insufficientReason, probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason: insufficientReason } },
        set1Winner: { status: 'insufficient', reason: insufficientReason, probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason: insufficientReason } },
        totalPoints: null,
        pointsHandicap: null,
        correctScore: null,
        setHandicap: null,
        set1TotalPoints: null,
        set1PointsHandicap: null,
        setCount: null,
        match1X2,
        totalGoals,
        goalsHandicap,
        firstHalf1X2: body.firstHalf1X2Odds ? empty1X2Market(insufficientReason) : null,
        firstHalfTotals: body.firstHalfTotalOdds ? emptyMultiMarket(insufficientReason) : null,
        firstHalfHandicap: body.firstHalfHandicapOdds ? emptyMultiMarket(insufficientReason) : null,
        expectedGoalsHome: null,
        expectedGoalsAway: null,
      }
    }

    return buildMarketOnlyResponse()
  }

  const ratingSql = `
    SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.home_advantage
    FROM football_team_ratings r
    JOIN football_teams t ON t.team_id = r.team_id
    WHERE r.discipline = ? AND r.team_id = ?
  `
  const awayRow = sqlite.prepare(ratingSql).get(body.discipline, body.awayTeamId) as TeamRatingRow | undefined
  const homeRow = sqlite.prepare(ratingSql).get(body.discipline, body.homeTeamId) as TeamRatingRow | undefined

  if (!awayRow || !homeRow) {
    const reason = '球隊不在這個項目的資料裡'
    return {
      sport: 'football',
      discipline: body.discipline,
      modelVersion: 'v1',
      set1Method: 'logistic',
      dataThrough: asOf,
      asOf,
      shrinkEnabled: false,
      sourceUrl: FOOTBALL_SOURCE_URL,
      away: awayRow ? toTeam(awayRow) : emptyTeam(body.awayTeamId),
      home: homeRow ? toTeam(homeRow) : emptyTeam(body.homeTeamId),
      isHome: body.isHome,
      warnings: [reason],
      matchWinner: { status: 'insufficient', reason, probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason } },
      set1Winner: { status: 'insufficient', reason, probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason } },
      totalPoints: null,
      pointsHandicap: null,
      correctScore: null,
      setHandicap: null,
      set1TotalPoints: null,
      set1PointsHandicap: null,
      setCount: null,
      match1X2: body.match1X2Odds ? empty1X2Market(reason) : null,
      totalGoals: body.totalOdds ? emptyMultiMarket(reason) : null,
      goalsHandicap: body.handicapOdds ? emptyMultiMarket(reason) : null,
      firstHalf1X2: body.firstHalf1X2Odds ? empty1X2Market(reason) : null,
      firstHalfTotals: body.firstHalfTotalOdds ? emptyMultiMarket(reason) : null,
      firstHalfHandicap: body.firstHalfHandicapOdds ? emptyMultiMarket(reason) : null,
      expectedGoalsHome: null,
      expectedGoalsAway: null,
    } as QuoteResponse
  }

  const away = toTeam(awayRow)
  const home = toTeam(homeRow)

  const model = sqlite.prepare(`
    SELECT model_version, data_through, payload
    FROM football_model_state
    WHERE discipline = ?
  `).get(body.discipline) as { model_version: string, data_through: string, payload: string } | undefined

  const dataThrough = model?.data_through ?? asOf
  const modelVersion = model?.model_version ?? 'elo-poisson-v1'

  const matchReady = away.matchCount >= FOOTBALL_MIN_MATCH_SAMPLE && home.matchCount >= FOOTBALL_MIN_MATCH_SAMPLE
  const shrinkMode: ShrinkMode = 'inactivity'

  const awayRating = effectiveRating(away.elo, away.matchCount, away.lastPlayedOn, asOf, shrinkMode)
  const homeRating = effectiveRating(home.elo, home.matchCount, home.lastPlayedOn, asOf, shrinkMode)

  const venueMode = venueModeForQuote(body.isHome, body.tournament ?? '')
  const { lambdaHome, lambdaAway } = expectedGoalsFromElo(homeRating, awayRating, body.isHome)

  const distribution = computeScoreDistribution(lambdaHome, lambdaAway)
  const halfTimeDistribution = firstHalfScoreDistribution(lambdaHome, lambdaAway)

  const dataLagOk = daysBetween(dataThrough, asOf) <= DATA_LAG_DAYS
  const staleOk = [away, home].every((team) => {
    if (!team.lastPlayedOn) return true
    return daysBetween(team.lastPlayedOn, dataThrough) <= STALE_TEAM_DAYS
  })
  const matchSampleOk = away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE

  const warnings: string[] = []
  if (!dataLagOk) warnings.push(`資料截至 ${dataThrough}，距報價日已超過 ${DATA_LAG_DAYS} 天`)
  if (!staleOk) warnings.push('有球隊超過半年未出賽，評分較不確定')
  if (!matchSampleOk) warnings.push('足球歷史只含運彩有開盤的場次，樣本可能不足')

  let match1X2: Market1X2Quote | null = null
  if (body.match1X2Odds) {
    const implied = impliedProbabilitiesFrom1X2Odds(
      body.match1X2Odds.home,
      body.match1X2Odds.draw,
      body.match1X2Odds.away
    )
    const evHome = matchReady ? distribution.homeWin * body.match1X2Odds.home - 1 : null
    const evDraw = matchReady ? distribution.draw * body.match1X2Odds.draw - 1 : null
    const evAway = matchReady ? distribution.awayWin * body.match1X2Odds.away - 1 : null

    const bestEv = Math.max(evHome ?? -Infinity, evDraw ?? -Infinity, evAway ?? -Infinity)
    let decision: Market1X2Quote['decision'] = { action: 'pass', outcome: null, reason: '所有選項期望值均為負' }
    if (bestEv > 0) {
      const outcome = evHome === bestEv ? 'home' : evDraw === bestEv ? 'draw' : 'away'
      if (!matchSampleOk || !dataLagOk || !staleOk) {
        decision = { action: 'watch', outcome, reason: '算式為正，但資料尚不充足' }
      } else if (bestEv < MIN_CANDIDATE_EV) {
        decision = { action: 'watch', outcome, reason: '算式為正，但優勢太薄' }
      } else {
        decision = { action: 'candidate', outcome, reason: '校準機率高於盈虧兩平' }
      }
    }

    match1X2 = {
      status: matchReady ? 'ok' : 'insufficient',
      reason: matchReady ? null : insufficientReason,
      probabilityHome: matchReady ? distribution.homeWin : null,
      probabilityDraw: matchReady ? distribution.draw : null,
      probabilityAway: matchReady ? distribution.awayWin : null,
      probabilityCalibratedHome: matchReady ? distribution.homeWin : null,
      probabilityCalibratedDraw: matchReady ? distribution.draw : null,
      probabilityCalibratedAway: matchReady ? distribution.awayWin : null,
      impliedHome: 1 / body.match1X2Odds.home,
      impliedDraw: 1 / body.match1X2Odds.draw,
      impliedAway: 1 / body.match1X2Odds.away,
      marketHome: implied.home,
      marketDraw: implied.draw,
      marketAway: implied.away,
      evHome,
      evDraw,
      evAway,
      decision,
    }
  }

  let totalGoals: MultiMarketQuote | null = null
  if (body.totalOdds) {
    const { line } = body.totalOdds
    const pOver = matchReady ? totalGoalsProbability(distribution, line, true) : 0
    const pUnder = matchReady ? 1 - pOver : 0
    const implied = devigMultiWay([body.totalOdds.over, body.totalOdds.under])

    const evOver = matchReady ? pOver * body.totalOdds.over - 1 : null
    const evUnder = matchReady ? pUnder * body.totalOdds.under - 1 : null

    totalGoals = {
      status: matchReady ? 'ok' : 'insufficient',
      reason: matchReady ? null : insufficientReason,
      line,
      summary: `預期總進球 ${(lambdaHome + lambdaAway).toFixed(2)}`,
      outcomes: [
        { key: 'over', label: `大 ${line}`, odds: body.totalOdds.over, probability: pOver, probabilityCalibrated: pOver, implied: 1 / body.totalOdds.over, market: implied[0] ?? null, ev: evOver },
        { key: 'under', label: `小 ${line}`, odds: body.totalOdds.under, probability: pUnder, probabilityCalibrated: pUnder, implied: 1 / body.totalOdds.under, market: implied[1] ?? null, ev: evUnder },
      ],
      decision: { action: 'pass', outcomeKey: null, reason: matchReady ? '大小球模型尚未校準' : insufficientReason },
    }
  }

  let goalsHandicap: MultiMarketQuote | null = null
  if (body.handicapOdds) {
    const { homeLine } = body.handicapOdds
    const awayLine = -homeLine
    const pAwayCovers = matchReady ? handicapProbability(distribution, homeLine, false) : 0
    const pHomeCovers = matchReady ? 1 - pAwayCovers : 0
    const implied = devigMultiWay([body.handicapOdds.away, body.handicapOdds.home])

    const evAway = matchReady ? pAwayCovers * body.handicapOdds.away - 1 : null
    const evHome = matchReady ? pHomeCovers * body.handicapOdds.home - 1 : null

    goalsHandicap = {
      status: matchReady ? 'ok' : 'insufficient',
      reason: matchReady ? null : insufficientReason,
      line: awayLine,
      summary: `預期進球差 ${(lambdaHome - lambdaAway).toFixed(2)}`,
      outcomes: [
        { key: 'away', label: `客 ${awayLine > 0 ? '+' : ''}${awayLine}`, odds: body.handicapOdds.away, probability: pAwayCovers, probabilityCalibrated: pAwayCovers, implied: 1 / body.handicapOdds.away, market: implied[0] ?? null, ev: evAway },
        { key: 'home', label: `主 ${homeLine > 0 ? '+' : ''}${homeLine}`, odds: body.handicapOdds.home, probability: pHomeCovers, probabilityCalibrated: pHomeCovers, implied: 1 / body.handicapOdds.home, market: implied[1] ?? null, ev: evHome },
      ],
      decision: { action: 'pass', outcomeKey: null, reason: matchReady ? '讓球模型尚未校準' : insufficientReason },
    }
  }

  return {
    sport: 'football',
    discipline: body.discipline,
    modelVersion,
    set1Method: 'logistic',
    dataThrough,
    asOf,
    shrinkEnabled: true,
    sourceUrl: FOOTBALL_SOURCE_URL,
    away,
    home,
    isHome: body.isHome,
    warnings,
    matchWinner: { status: 'insufficient', reason: '足球使用 1X2 市場', probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason: '足球使用 1X2 市場' } },
    set1Winner: { status: 'insufficient', reason: '足球無此市場', probabilityAway: null, probabilityHome: null, probabilityCalibratedAway: null, probabilityCalibratedHome: null, impliedAway: null, impliedHome: null, marketAway: null, marketHome: null, evAway: null, evHome: null, decision: { action: 'pass', side: null, reason: '足球無此市場' } },
    totalPoints: null,
    pointsHandicap: null,
    correctScore: null,
    setHandicap: null,
    set1TotalPoints: null,
    set1PointsHandicap: null,
    setCount: null,
    match1X2,
    totalGoals,
    goalsHandicap,
    firstHalf1X2: body.firstHalf1X2Odds ? empty1X2Market('上半場模型尚未實作') : null,
    firstHalfTotals: body.firstHalfTotalOdds ? emptyMultiMarket('上半場模型尚未實作') : null,
    firstHalfHandicap: body.firstHalfHandicapOdds ? emptyMultiMarket('上半場模型尚未實作') : null,
    expectedGoalsHome: lambdaHome,
    expectedGoalsAway: lambdaAway,
  } as QuoteResponse
})
