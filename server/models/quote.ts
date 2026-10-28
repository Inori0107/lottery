import type { Set1Method, MarketQuote, MultiMarketQuote, OutcomeQuote, PlayerOption } from '../../shared/types'
import {
  calibrateProbability,
  marketAction,
  MIN_CANDIDATE_EV,
  MIN_CANDIDATE_SAMPLE,
  MIN_GAME1_CANDIDATE_EV,
  MIN_POINTS_CANDIDATE_EV,
  outcomeAction,
  POINTS_CAUTION,
  type CalibrationBin,
} from '../../shared/decision'
import {
  DATA_LAG_DAYS,
  MIN_SET1_SAMPLE,
  MIN_MATCH_SAMPLE,
  STALE_PLAYER_DAYS,
} from './constants'
import { daysBetween, effectiveRating, expectedScore, type ShrinkMode } from './elo'
import {
  clampGame1ToMatch,
  matchProbabilityToGame1,
  predictBin,
  predictLogistic,
  shrunkWinRate,
  type LogisticCoefficients,
  type ProbabilityBin,
} from './game1'
import { devigMultiWay, devigTwoWay, expectedValue, impliedProbability } from './odds'
import {
  CORRECT_SCORES,
  coversHandicap,
  distributionMean,
  fairLine,
  gamePointDistributions,
  matchDistribution,
  probabilityAbove,
  rallyProbability,
  setCountFromCorrectScore,
  type CorrectScore,
  type MatchDistribution,
  type RallyModel,
} from './rally'

export type OddsPair = { away: number, home: number }

export type TotalOdds = { line: number, over: number, under: number }

export type HandicapOdds = { awayLine: number, away: number, home: number }

export type CorrectScoreOdds = Record<CorrectScore, number>

export type QuoteOdds = {
  match?: OddsPair
  game1?: OddsPair
  totals?: TotalOdds
  handicap?: HandicapOdds
  correctScore?: CorrectScoreOdds
  set1Totals?: TotalOdds
  set1Handicap?: HandicapOdds
  setCount?: Record<string, number>
}

export type QuoteModel = {
  method: Set1Method
  coefficients: LogisticCoefficients
  bins: ProbabilityBin[]
  shrinkMode: ShrinkMode
  matchCalibration?: CalibrationBin[]
  game1Calibration?: CalibrationBin[]
  rally?: RallyModel
  totalsCalibration?: CalibrationBin[]
  handicapCalibration?: CalibrationBin[]
  correctScoreCalibration?: CalibrationBin[]
}

export const emptyMarket = (reason: string): MarketQuote => ({
  status: 'insufficient',
  reason,
  probabilityAway: null,
  probabilityHome: null,
  probabilityCalibratedAway: null,
  probabilityCalibratedHome: null,
  impliedAway: null,
  impliedHome: null,
  marketAway: null,
  marketHome: null,
  evAway: null,
  evHome: null,
  decision: { action: 'pass', side: null, reason },
})

type BuildMarketOptions = {
  odds?: OddsPair
  reason?: string
  calibration?: CalibrationBin[]
  minEv: number
  sampleOk: boolean
  dataLagOk: boolean
  staleOk: boolean
  isGame1?: boolean
  awayName?: string
  homeName?: string
}

export const buildMarketQuote = (probabilityAway: number | null, options: BuildMarketOptions): MarketQuote => {
  if (probabilityAway === null) return emptyMarket(options.reason ?? '樣本不足')

  const probabilityHome = 1 - probabilityAway
  const probabilityCalibratedAway = calibrateProbability(probabilityAway, options.calibration ?? [])
  const probabilityCalibratedHome = 1 - probabilityCalibratedAway
  const impliedAway = options.odds ? impliedProbability(options.odds.away) : null
  const impliedHome = options.odds ? impliedProbability(options.odds.home) : null
  const market = options.odds ? devigTwoWay(options.odds.away, options.odds.home) : null
  const evAway = options.odds ? expectedValue(probabilityCalibratedAway, options.odds.away) : null
  const evHome = options.odds ? expectedValue(probabilityCalibratedHome, options.odds.home) : null

  return {
    status: 'ok',
    reason: null,
    probabilityAway,
    probabilityHome,
    probabilityCalibratedAway,
    probabilityCalibratedHome,
    impliedAway,
    impliedHome,
    marketAway: market?.marketA ?? null,
    marketHome: market?.marketB ?? null,
    evAway,
    evHome,
    decision: marketAction({
      evAway,
      evHome,
      probabilityAway: probabilityCalibratedAway,
      probabilityHome: probabilityCalibratedHome,
      marketAway: market?.marketA ?? null,
      marketHome: market?.marketB ?? null,
      minEv: options.minEv,
      sampleOk: options.sampleOk,
      dataLagOk: options.dataLagOk,
      staleOk: options.staleOk,
      isGame1: options.isGame1,
      awayName: options.awayName,
      homeName: options.homeName,
    }),
  }
}

export type PointsMarkets = {
  totalPoints: MultiMarketQuote | null
  pointsHandicap: MultiMarketQuote | null
  correctScore: MultiMarketQuote | null
  set1TotalPoints: MultiMarketQuote | null
  set1PointsHandicap: MultiMarketQuote | null
  setCount: MultiMarketQuote | null
}

export const emptyMultiMarket = (reason: string): MultiMarketQuote => ({
  status: 'insufficient',
  reason,
  line: null,
  summary: null,
  outcomes: [],
  decision: { action: 'pass', outcomeKey: null, reason },
})

type OutcomeInput = { key: string, label: string, probability: number }

type BuildMultiMarketOptions = {
  odds?: number[]
  calibrated: number[]
  line?: number | null
  summary?: string | null
  minEv: number
  sampleOk: boolean
  dataLagOk: boolean
  staleOk: boolean
  allowCandidate?: boolean
}

export const buildMultiMarketQuote = (outcomes: OutcomeInput[], options: BuildMultiMarketOptions): MultiMarketQuote => {
  const market = options.odds ? devigMultiWay(options.odds) : null
  const quoted: OutcomeQuote[] = outcomes.map((outcome, index) => {
    const odds = options.odds?.[index] ?? null
    const probabilityCalibrated = options.calibrated[index] ?? outcome.probability
    return {
      ...outcome,
      odds,
      probabilityCalibrated,
      implied: odds === null ? null : impliedProbability(odds),
      market: market?.[index] ?? null,
      ev: odds === null ? null : expectedValue(probabilityCalibrated, odds),
    }
  })

  return {
    status: 'ok',
    reason: null,
    line: options.line ?? null,
    summary: options.summary ?? null,
    outcomes: quoted,
    decision: outcomeAction({
      outcomes: quoted.map(outcome => ({
        key: outcome.key,
        ev: outcome.ev,
        probability: outcome.probabilityCalibrated,
        market: outcome.market,
        name: outcome.label,
      })),
      minEv: options.minEv,
      sampleOk: options.sampleOk,
      dataLagOk: options.dataLagOk,
      staleOk: options.staleOk,
      caution: POINTS_CAUTION,
      allowCandidate: options.allowCandidate ?? false,
    }),
  }
}

export const calibrateTwoWay = (probability: number, bins: CalibrationBin[] = []) => {
  const calibrated = calibrateProbability(probability, bins)
  return [calibrated, 1 - calibrated]
}

export const calibrateMultiWay = (probabilities: number[], bins: CalibrationBin[] = []) => {
  const calibrated = probabilities.map(probability => calibrateProbability(probability, bins))
  const sum = calibrated.reduce((total, value) => total + value, 0)
  return calibrated.map(value => value / sum)
}

const signedLine = (line: number) => (line > 0 ? `+${line}` : `${line}`)

type PointsMarketContext = {
  distribution: MatchDistribution
  awayName: string
  homeName: string
  model: QuoteModel
  quality: Pick<BuildMultiMarketOptions, 'sampleOk' | 'dataLagOk' | 'staleOk'>
}

const quoteTotals = ({ distribution, model, quality }: PointsMarketContext, totals: TotalOdds) => {
  const { line } = totals
  const probabilityOver = probabilityAbove(distribution.total, line)
  return buildMultiMarketQuote([
    { key: 'over', label: `大 ${line}`, probability: probabilityOver },
    { key: 'under', label: `小 ${line}`, probability: 1 - probabilityOver },
  ], {
    ...quality,
    odds: [totals.over, totals.under],
    calibrated: calibrateTwoWay(probabilityOver, model.totalsCalibration),
    line,
    summary: `預期總分 ${distributionMean(distribution.total).toFixed(1)}，模型 50% 線 ${fairLine(distribution.total)}（兩局與三局分數差很多，平均數不等於 50% 線）`,
    minEv: MIN_POINTS_CANDIDATE_EV,
  })
}

const quoteHandicap = (
  { distribution, awayName, homeName, model, quality }: PointsMarketContext,
  handicap: HandicapOdds,
) => {
  const { awayLine } = handicap
  const probabilityAwayCovers = coversHandicap(distribution.margin, awayLine)
  const expectedMargin = distributionMean(distribution.margin)
  return buildMultiMarketQuote([
    { key: 'away', label: `${awayName} ${signedLine(awayLine)}`, probability: probabilityAwayCovers },
    { key: 'home', label: `${homeName} ${signedLine(-awayLine)}`, probability: 1 - probabilityAwayCovers },
  ], {
    ...quality,
    odds: [handicap.away, handicap.home],
    calibrated: calibrateTwoWay(probabilityAwayCovers, model.handicapCalibration),
    line: awayLine,
    summary: `預期分差 ${awayName} ${signedLine(Number(expectedMargin.toFixed(1)))}，模型 50% 讓分線 ${signedLine(-fairLine(distribution.margin))}`,
    minEv: MIN_POINTS_CANDIDATE_EV,
  })
}

const quoteCorrectScore = ({ distribution, model, quality }: PointsMarketContext, scoreOdds: CorrectScoreOdds) => {
  const probabilities = CORRECT_SCORES.map(score => distribution.correctScore[score])
  return buildMultiMarketQuote(
    CORRECT_SCORES.map((score, index) => ({ key: score, label: score, probability: probabilities[index] ?? 0 })),
    {
      ...quality,
      odds: CORRECT_SCORES.map(score => scoreOdds[score]),
      calibrated: calibrateMultiWay(probabilities, model.correctScoreCalibration),
      summary: '比數為客:主',
      minEv: MIN_POINTS_CANDIDATE_EV,
    },
  )
}

const quoteSetCount = (
  { distribution, quality }: PointsMarketContext,
  setCount: Record<string, number>,
) => {
  const probabilities = setCountFromCorrectScore(distribution.correctScore)
  const keys = Object.keys(setCount).sort()
  return buildMultiMarketQuote(
    keys.map(key => ({ key, label: `${key} 局`, probability: probabilities[key as '2' | '3'] ?? 0 })),
    {
      ...quality,
      odds: keys.map(key => setCount[key] ?? 0),
      calibrated: calibrateMultiWay(keys.map(key => probabilities[key as '2' | '3'] ?? 0)),
      summary: '正確總局數',
      minEv: MIN_POINTS_CANDIDATE_EV,
    },
  )
}

const matchModeForQuote = (mode: ShrinkMode): ShrinkMode =>
  mode === 'full' ? 'full' : 'inactivity'

const ratingForQuote = (
  player: PlayerOption,
  asOf: string,
  mode: ShrinkMode,
) => (
  effectiveRating(player.elo, player.matchCount, player.lastPlayedOn, asOf, mode)
)

const game1SideA = (
  method: Set1Method,
  pMatchSideA: number,
  eloDiff: number,
  formDiff: number,
  model: QuoteModel,
) => {
  if (method === 'logistic') return predictLogistic(model.coefficients, eloDiff, formDiff)
  if (method === 'bins') return predictBin(model.bins, eloDiff)
  return matchProbabilityToGame1(pMatchSideA)
}

const idleDaysAtCutoff = (player: PlayerOption, dataThrough: string) => {
  if (!player.lastPlayedOn) return null
  return daysBetween(player.lastPlayedOn, dataThrough)
}

export const buildQuoteWarnings = (
  away: PlayerOption,
  home: PlayerOption,
  asOf: string,
  dataThrough: string,
  shrinkEnabled: boolean,
) => {
  const warnings: string[] = []
  const dataLag = daysBetween(dataThrough, asOf)
  if (dataLag > DATA_LAG_DAYS) {
    warnings.push(`資料截至 ${dataThrough}，距報價日已 ${dataLag} 天，之後的賽果沒進模型。`)
  }
  if (shrinkEnabled) {
    warnings.push('樣本數較少時會再向 1500 收縮。')
  }
  const staleFor = (label: string, player: PlayerOption) => {
    const idleDays = idleDaysAtCutoff(player, dataThrough)
    if (idleDays === null || idleDays <= STALE_PLAYER_DAYS) return
    warnings.push(`${label}最後出賽 ${player.lastPlayedOn}，資料截止時已 ${idleDays} 天未出賽，分數較不確定。`)
  }
  staleFor('客隊', away)
  staleFor('主隊', home)
  return warnings
}

export const quotePlayersWithForm = (
  away: PlayerOption & { game1Recent: number[] },
  home: PlayerOption & { game1Recent: number[] },
  model: QuoteModel,
  odds: QuoteOdds,
  dataThrough: string,
  quoteAsOf = dataThrough,
) => {
  const matchReady = away.matchCount >= MIN_MATCH_SAMPLE && home.matchCount >= MIN_MATCH_SAMPLE
  const set1Ready = away.set1Count >= MIN_SET1_SAMPLE && home.set1Count >= MIN_SET1_SAMPLE
  const matchMode = matchModeForQuote(model.shrinkMode)
  const awayRating = ratingForQuote(away, dataThrough, matchMode)
  const homeRating = ratingForQuote(home, dataThrough, matchMode)
  const awayFeature = ratingForQuote(away, dataThrough, model.shrinkMode)
  const homeFeature = ratingForQuote(home, dataThrough, model.shrinkMode)
  const awayIsSideA = away.id < home.id
  const eloDiff = awayIsSideA ? awayFeature - homeFeature : homeFeature - awayFeature
  const formDiff = awayIsSideA
    ? shrunkWinRate(away.game1Recent) - shrunkWinRate(home.game1Recent)
    : shrunkWinRate(home.game1Recent) - shrunkWinRate(away.game1Recent)
  const pMatchAway = expectedScore(awayRating, homeRating)
  const pMatchSideA = awayIsSideA ? pMatchAway : 1 - pMatchAway
  const pGame1SideA = clampGame1ToMatch(
    game1SideA(model.method, pMatchSideA, eloDiff, formDiff, model),
    pMatchSideA,
  )
  const pGame1Away = awayIsSideA ? pGame1SideA : 1 - pGame1SideA
  const quality = {
    dataLagOk: daysBetween(dataThrough, quoteAsOf) <= DATA_LAG_DAYS,
    staleOk: [away, home].every((player) => {
      const idleDays = idleDaysAtCutoff(player, dataThrough)
      return idleDays === null || idleDays <= STALE_PLAYER_DAYS
    }),
    awayName: away.name,
    homeName: home.name,
  }
  const buildPointsMarkets = (): PointsMarkets => {
    const emptyFilled = (reason: string): PointsMarkets => {
      const empty = emptyMultiMarket(reason)
      return {
        totalPoints: odds.totals ? empty : null,
        pointsHandicap: odds.handicap ? empty : null,
        correctScore: odds.correctScore ? empty : null,
        set1TotalPoints: odds.set1Totals ? empty : null,
        set1PointsHandicap: odds.set1Handicap ? empty : null,
        setCount: odds.setCount ? empty : null,
      }
    }
    const none = !odds.totals && !odds.handicap && !odds.correctScore
      && !odds.set1Totals && !odds.set1Handicap && !odds.setCount
    if (none) {
      return {
        totalPoints: null,
        pointsHandicap: null,
        correctScore: null,
        set1TotalPoints: null,
        set1PointsHandicap: null,
        setCount: null,
      }
    }
    if (!model.rally) return emptyFilled('分數模型尚未建立，請重新執行 update:data')
    if (!matchReady) return emptyFilled(`任一方全場樣本少於 ${MIN_MATCH_SAMPLE} 場`)
    const rallySideA = rallyProbability(model.rally.coefficients, eloDiff)
    const rallyAway = awayIsSideA ? rallySideA : 1 - rallySideA
    const context: PointsMarketContext = {
      distribution: matchDistribution(rallyAway, model.rally.sigma, model.rally.tau ?? 0),
      awayName: away.name,
      homeName: home.name,
      model,
      quality: {
        sampleOk: away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE,
        dataLagOk: quality.dataLagOk,
        staleOk: quality.staleOk,
      },
    }
    const set1 = gamePointDistributions(rallyAway, model.rally.sigma, model.rally.tau ?? 0)
    const set1Context = { ...context, model: { ...model, totalsCalibration: [], handicapCalibration: [] } }
    return {
      totalPoints: odds.totals ? quoteTotals(context, odds.totals) : null,
      pointsHandicap: odds.handicap ? quoteHandicap(context, odds.handicap) : null,
      correctScore: odds.correctScore ? quoteCorrectScore(context, odds.correctScore) : null,
      set1TotalPoints: odds.set1Totals ? {
        ...quoteTotals({ ...set1Context, distribution: { ...context.distribution, total: set1.total } }, odds.set1Totals),
        calibrationApplied: false,
        summary: `第一局預期總分 ${distributionMean(set1.total).toFixed(1)}，尚未獨立校準與真實盤口回測`,
      } : null,
      set1PointsHandicap: odds.set1Handicap
        ? { ...quoteHandicap({ ...set1Context, distribution: { ...context.distribution, margin: set1.margin } }, odds.set1Handicap), calibrationApplied: false }
        : null,
      setCount: odds.setCount ? quoteSetCount(context, odds.setCount) : null,
    }
  }

  return {
    ...buildPointsMarkets(),
    matchWinner: buildMarketQuote(matchReady ? pMatchAway : null, {
      ...quality,
      odds: odds.match,
      reason: `任一方全場樣本少於 ${MIN_MATCH_SAMPLE} 場`,
      calibration: model.matchCalibration,
      minEv: MIN_CANDIDATE_EV,
      sampleOk: away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE,
    }),
    set1Winner: buildMarketQuote(set1Ready ? pGame1Away : null, {
      ...quality,
      odds: odds.game1,
      reason: `任一方第一局樣本少於 ${MIN_SET1_SAMPLE} 場`,
      calibration: model.game1Calibration,
      minEv: MIN_GAME1_CANDIDATE_EV,
      sampleOk: away.set1Count >= MIN_CANDIDATE_SAMPLE && home.set1Count >= MIN_CANDIDATE_SAMPLE,
      isGame1: true,
    }),
  }
}
