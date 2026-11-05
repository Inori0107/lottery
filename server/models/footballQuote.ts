/**
 * 足球報價模組
 *
 * 提供與 API 端點相同的報價邏輯，供 analysisPack 使用。
 */

import type Database from 'better-sqlite3'
import type { TeamOption, QuoteResponse, FootballDiscipline, Market1X2Quote, MultiMarketQuote } from '../../shared/types'
import { FOOTBALL_SOURCE_URL, FOOTBALL_MIN_MATCH_SAMPLE } from './constants'
import { MIN_CANDIDATE_EV, MIN_CANDIDATE_SAMPLE } from '../../shared/decision'
import { daysBetween } from './eloCore'
import { effectiveRating, venueModeForQuote, type ShrinkMode } from './footballElo'
import {
  computeScoreDistribution,
  expectedGoalsFromElo,
  totalGoalsProbability,
  handicapProbability,
  impliedProbabilitiesFrom1X2Odds,
} from './footballGoals'
import { devigMultiWay } from './odds'

type FootballQuoteInput = {
  discipline: FootballDiscipline
  awayTeamId: string
  homeTeamId: string
  isHome: boolean
  tournament?: string
  match1X2Odds?: { home: number, draw: number, away: number }
  totalOdds?: { line: number, over: number, under: number }
  handicapOdds?: { awayLine: number, away: number, home: number }
  firstHalf1X2Odds?: { home: number, draw: number, away: number }
  firstHalfTotalOdds?: { line: number, over: number, under: number }
  firstHalfHandicapOdds?: { awayLine: number, away: number, home: number }
}

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

const insufficientReason = '模型資料不足，僅供參考'

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

export const quoteFootball = (
  sqlite: Database.Database,
  input: FootballQuoteInput,
): QuoteResponse => {
  const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='football_team_ratings'
  `).get()

  if (!tableExists) {
    const away = emptyTeam(input.awayTeamId)
    const home = emptyTeam(input.homeTeamId)

    let match1X2: Market1X2Quote | null = null
    if (input.match1X2Odds) {
      const implied = impliedProbabilitiesFrom1X2Odds(
        input.match1X2Odds.home,
        input.match1X2Odds.draw,
        input.match1X2Odds.away
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
        impliedHome: 1 / input.match1X2Odds.home,
        impliedDraw: 1 / input.match1X2Odds.draw,
        impliedAway: 1 / input.match1X2Odds.away,
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
    if (input.totalOdds) {
      const implied = devigMultiWay([input.totalOdds.over, input.totalOdds.under])
      totalGoals = {
        status: 'insufficient',
        reason: insufficientReason,
        line: input.totalOdds.line,
        summary: `盤口 ${input.totalOdds.line}`,
        outcomes: [
          { key: 'over', label: `大 ${input.totalOdds.line}`, odds: input.totalOdds.over, probability: 0, probabilityCalibrated: 0, implied: 1 / input.totalOdds.over, market: implied[0] ?? null, ev: null },
          { key: 'under', label: `小 ${input.totalOdds.line}`, odds: input.totalOdds.under, probability: 0, probabilityCalibrated: 0, implied: 1 / input.totalOdds.under, market: implied[1] ?? null, ev: null },
        ],
        decision: { action: 'pass', outcomeKey: null, reason: insufficientReason },
      }
    }

    let goalsHandicap: MultiMarketQuote | null = null
    if (input.handicapOdds) {
      const implied = devigMultiWay([input.handicapOdds.away, input.handicapOdds.home])
      const awayLine = input.handicapOdds.awayLine
      goalsHandicap = {
        status: 'insufficient',
        reason: insufficientReason,
        line: awayLine,
        summary: `讓球 ${awayLine > 0 ? '+' : ''}${awayLine}`,
        outcomes: [
          { key: 'away', label: `客 ${awayLine > 0 ? '+' : ''}${awayLine}`, odds: input.handicapOdds.away, probability: 0, probabilityCalibrated: 0, implied: 1 / input.handicapOdds.away, market: implied[0] ?? null, ev: null },
          { key: 'home', label: `主 ${-awayLine > 0 ? '+' : ''}${-awayLine}`, odds: input.handicapOdds.home, probability: 0, probabilityCalibrated: 0, implied: 1 / input.handicapOdds.home, market: implied[1] ?? null, ev: null },
        ],
        decision: { action: 'pass', outcomeKey: null, reason: insufficientReason },
      }
    }

    return {
      sport: 'football',
      discipline: input.discipline,
      modelVersion: 'market-only-v1',
      set1Method: 'logistic',
      dataThrough: asOf,
      asOf,
      shrinkEnabled: false,
      sourceUrl: FOOTBALL_SOURCE_URL,
      away,
      home,
      isHome: input.isHome,
      warnings: [insufficientReason],
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
      firstHalf1X2: input.firstHalf1X2Odds ? empty1X2Market(insufficientReason) : null,
      firstHalfTotals: input.firstHalfTotalOdds ? emptyMultiMarket(insufficientReason) : null,
      firstHalfHandicap: input.firstHalfHandicapOdds ? emptyMultiMarket(insufficientReason) : null,
      expectedGoalsHome: null,
      expectedGoalsAway: null,
    }
  }

  const ratingSql = `
    SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.home_advantage
    FROM football_team_ratings r
    JOIN football_teams t ON t.team_id = r.team_id
    WHERE r.discipline = ? AND r.team_id = ?
  `
  const awayRow = sqlite.prepare(ratingSql).get(input.discipline, input.awayTeamId) as TeamRatingRow | undefined
  const homeRow = sqlite.prepare(ratingSql).get(input.discipline, input.homeTeamId) as TeamRatingRow | undefined

  if (!awayRow || !homeRow) {
    const reason = '球隊不在這個項目的資料裡'
    return {
      sport: 'football',
      discipline: input.discipline,
      modelVersion: 'v1',
      set1Method: 'logistic',
      dataThrough: asOf,
      asOf,
      shrinkEnabled: false,
      sourceUrl: FOOTBALL_SOURCE_URL,
      away: awayRow ? toTeam(awayRow) : emptyTeam(input.awayTeamId),
      home: homeRow ? toTeam(homeRow) : emptyTeam(input.homeTeamId),
      isHome: input.isHome,
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
      match1X2: input.match1X2Odds ? empty1X2Market(reason) : null,
      totalGoals: input.totalOdds ? emptyMultiMarket(reason) : null,
      goalsHandicap: input.handicapOdds ? emptyMultiMarket(reason) : null,
      firstHalf1X2: input.firstHalf1X2Odds ? empty1X2Market(reason) : null,
      firstHalfTotals: input.firstHalfTotalOdds ? emptyMultiMarket(reason) : null,
      firstHalfHandicap: input.firstHalfHandicapOdds ? emptyMultiMarket(reason) : null,
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
  `).get(input.discipline) as { model_version: string, data_through: string, payload: string } | undefined

  const dataThrough = model?.data_through ?? asOf
  const modelVersion = model?.model_version ?? 'elo-poisson-v1'

  const matchReady = away.matchCount >= FOOTBALL_MIN_MATCH_SAMPLE && home.matchCount >= FOOTBALL_MIN_MATCH_SAMPLE
  const shrinkMode: ShrinkMode = 'inactivity'

  const awayRating = effectiveRating(away.elo, away.matchCount, away.lastPlayedOn, asOf, shrinkMode)
  const homeRating = effectiveRating(home.elo, home.matchCount, home.lastPlayedOn, asOf, shrinkMode)

  const lambdaHome = matchReady ? expectedGoalsFromElo(homeRating, awayRating, input.isHome).lambdaHome : null
  const lambdaAway = matchReady ? expectedGoalsFromElo(homeRating, awayRating, input.isHome).lambdaAway : null

  const distribution = matchReady && lambdaHome !== null && lambdaAway !== null
    ? computeScoreDistribution(lambdaHome, lambdaAway)
    : null

  const dataLagOk = daysBetween(dataThrough, asOf) <= DATA_LAG_DAYS
  const staleOk = [away, home].every((team) => {
    if (!team.lastPlayedOn) return true
    return daysBetween(team.lastPlayedOn, dataThrough) <= STALE_TEAM_DAYS
  })
  const matchSampleOk = away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE

  const warnings: string[] = []
  if (!matchReady) warnings.push(insufficientReason)
  if (!dataLagOk) warnings.push(`資料截至 ${dataThrough}，距報價日已超過 ${DATA_LAG_DAYS} 天`)
  if (!staleOk) warnings.push('有球隊超過半年未出賽，評分較不確定')
  if (!matchSampleOk && matchReady) warnings.push('足球歷史只含運彩有開盤的場次，樣本可能不足')

  let match1X2: Market1X2Quote | null = null
  if (input.match1X2Odds) {
    const implied = impliedProbabilitiesFrom1X2Odds(
      input.match1X2Odds.home,
      input.match1X2Odds.draw,
      input.match1X2Odds.away
    )
    const evHome = distribution ? distribution.homeWin * input.match1X2Odds.home - 1 : null
    const evDraw = distribution ? distribution.draw * input.match1X2Odds.draw - 1 : null
    const evAway = distribution ? distribution.awayWin * input.match1X2Odds.away - 1 : null

    const bestEv = Math.max(evHome ?? -Infinity, evDraw ?? -Infinity, evAway ?? -Infinity)
    let decision: Market1X2Quote['decision'] = { action: 'pass', outcome: null, reason: distribution ? '所有選項期望值均為負' : insufficientReason }
    if (distribution && bestEv > 0) {
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
      status: distribution ? 'ok' : 'insufficient',
      reason: distribution ? null : insufficientReason,
      probabilityHome: distribution?.homeWin ?? null,
      probabilityDraw: distribution?.draw ?? null,
      probabilityAway: distribution?.awayWin ?? null,
      probabilityCalibratedHome: distribution?.homeWin ?? null,
      probabilityCalibratedDraw: distribution?.draw ?? null,
      probabilityCalibratedAway: distribution?.awayWin ?? null,
      impliedHome: 1 / input.match1X2Odds.home,
      impliedDraw: 1 / input.match1X2Odds.draw,
      impliedAway: 1 / input.match1X2Odds.away,
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
  if (input.totalOdds) {
    const { line } = input.totalOdds
    const pOver = distribution ? totalGoalsProbability(distribution, line, true) : null
    const pUnder = distribution ? 1 - pOver! : null
    const implied = devigMultiWay([input.totalOdds.over, input.totalOdds.under])

    const evOver = pOver !== null ? pOver * input.totalOdds.over - 1 : null
    const evUnder = pUnder !== null ? pUnder * input.totalOdds.under - 1 : null

    totalGoals = {
      status: distribution ? 'ok' : 'insufficient',
      reason: distribution ? null : insufficientReason,
      line,
      summary: lambdaHome !== null && lambdaAway !== null ? `預期總進球 ${(lambdaHome + lambdaAway).toFixed(2)}` : '盤口去水機率',
      outcomes: [
        { key: 'over', label: `大 ${line}`, odds: input.totalOdds.over, probability: pOver ?? 0, probabilityCalibrated: pOver ?? 0, implied: 1 / input.totalOdds.over, market: implied[0] ?? null, ev: evOver },
        { key: 'under', label: `小 ${line}`, odds: input.totalOdds.under, probability: pUnder ?? 0, probabilityCalibrated: pUnder ?? 0, implied: 1 / input.totalOdds.under, market: implied[1] ?? null, ev: evUnder },
      ],
      decision: { action: 'pass', outcomeKey: null, reason: distribution ? '大小球模型尚未校準' : insufficientReason },
    }
  }

  let goalsHandicap: MultiMarketQuote | null = null
  if (input.handicapOdds) {
    const { awayLine } = input.handicapOdds
    const homeLine = -awayLine
    const pAwayCovers = distribution ? handicapProbability(distribution, homeLine, false) : null
    const pHomeCovers = pAwayCovers !== null ? 1 - pAwayCovers : null
    const implied = devigMultiWay([input.handicapOdds.away, input.handicapOdds.home])

    const evAway = pAwayCovers !== null ? pAwayCovers * input.handicapOdds.away - 1 : null
    const evHome = pHomeCovers !== null ? pHomeCovers * input.handicapOdds.home - 1 : null

    goalsHandicap = {
      status: distribution ? 'ok' : 'insufficient',
      reason: distribution ? null : insufficientReason,
      line: awayLine,
      summary: lambdaHome !== null && lambdaAway !== null ? `預期進球差 ${(lambdaHome - lambdaAway).toFixed(2)}` : '盤口去水機率',
      outcomes: [
        { key: 'away', label: `客 ${awayLine > 0 ? '+' : ''}${awayLine}`, odds: input.handicapOdds.away, probability: pAwayCovers ?? 0, probabilityCalibrated: pAwayCovers ?? 0, implied: 1 / input.handicapOdds.away, market: implied[0] ?? null, ev: evAway },
        { key: 'home', label: `主 ${homeLine > 0 ? '+' : ''}${homeLine}`, odds: input.handicapOdds.home, probability: pHomeCovers ?? 0, probabilityCalibrated: pHomeCovers ?? 0, implied: 1 / input.handicapOdds.home, market: implied[1] ?? null, ev: evHome },
      ],
      decision: { action: 'pass', outcomeKey: null, reason: distribution ? '讓球模型尚未校準' : insufficientReason },
    }
  }

  return {
    sport: 'football',
    discipline: input.discipline,
    modelVersion,
    set1Method: 'logistic',
    dataThrough,
    asOf,
    shrinkEnabled: true,
    sourceUrl: FOOTBALL_SOURCE_URL,
    away,
    home,
    isHome: input.isHome,
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
    firstHalf1X2: input.firstHalf1X2Odds ? empty1X2Market('上半場模型尚未實作') : null,
    firstHalfTotals: input.firstHalfTotalOdds ? emptyMultiMarket('上半場模型尚未實作') : null,
    firstHalfHandicap: input.firstHalfHandicapOdds ? emptyMultiMarket('上半場模型尚未實作') : null,
    expectedGoalsHome: lambdaHome,
    expectedGoalsAway: lambdaAway,
  } as QuoteResponse
}
