import type Database from 'better-sqlite3'
import type { Set1Method, PlayerOption, QuoteResponse } from '../../shared/types'
import { SOURCE_URL } from './constants'
import type { ModelPayload } from './backtest'
import {
  buildQuoteWarnings,
  emptyHandicapMarket,
  emptyMarket,
  emptyScoreMarket,
  emptyTotalsMarket,
  quotePlayersWithForm,
} from './quote'

export type BadmintonQuoteInput = {
  discipline: 'MS' | 'WS'
  awayPlayerId: string
  homePlayerId: string
  matchOdds?: { away: number, home: number }
  game1Odds?: { away: number, home: number }
  totalOdds?: { line: number, over: number, under: number }
  handicapOdds?: { awayLine: number, away: number, home: number }
  correctScoreOdds?: Record<'2:0' | '2:1' | '1:2' | '0:2', number>
}

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

export const quoteBadminton = (sqlite: Database.Database, body: BadmintonQuoteInput): QuoteResponse => {
  if (body.awayPlayerId === body.homePlayerId) {
    throw new Error('請選擇兩位不同選手')
  }
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
  const quoted = quotePlayersWithForm(away, home, {
    method: model.set1_method,
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
    quoted.matchWinner = emptyMarket(reason, body.matchOdds)
    quoted.set1Winner = emptyMarket(reason, body.game1Odds)
    quoted.totalPoints = body.totalOdds ? emptyTotalsMarket(reason, body.totalOdds) : quoted.totalPoints
    quoted.pointsHandicap = body.handicapOdds
      ? emptyHandicapMarket(reason, body.handicapOdds, away.name, home.name)
      : quoted.pointsHandicap
    quoted.correctScore = body.correctScoreOdds ? emptyScoreMarket(reason, body.correctScoreOdds) : quoted.correctScore
  }

  return {
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
      : [INSUFFICIENT_PLACEHOLDER],
    matchWinner: quoted.matchWinner,
    set1Winner: quoted.set1Winner,
    totalPoints: quoted.totalPoints,
    pointsHandicap: quoted.pointsHandicap,
    correctScore: quoted.correctScore,
    setHandicap: null,
    set1TotalPoints: null,
    set1PointsHandicap: null,
  }
}

const INSUFFICIENT_PLACEHOLDER = '選手不在這個項目的資料裡'
