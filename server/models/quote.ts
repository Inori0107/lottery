import type { Set1Method, MarketQuote, MultiMarketQuote, OutcomeQuote, PlayerOption } from '../../shared/types'
import {
  calibrateProbability,
  DIVERGENCE_FLAG,
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
import { calibrateSide } from './calibration'
import { predictFirstGame } from './badmintonInference'
import { probabilityEvidence } from '../../shared/strategy'
import {
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
import {
  blendProbability,
  checkDivergence,
  mildCalibrate,
  DEFAULT_MODEL_CONFIG,
  type CalibrationMode,
  type MarketBlendingConfig,
  type DivergenceGuardConfig,
} from '../../shared/modelConfig'

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
  validationReady?: boolean
  game1ValidationReady?: boolean
  matchReliability?: CalibrationBin[]
  game1Reliability?: CalibrationBin[]
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
  calibrationMode?: CalibrationMode
  blendConfig?: MarketBlendingConfig
  divergenceConfig?: DivergenceGuardConfig
}

export const emptyMarket = (reason: string, odds?: OddsPair): MarketQuote => {
  const impliedAway = odds ? impliedProbability(odds.away) : null
  const impliedHome = odds ? impliedProbability(odds.home) : null
  const market = odds ? devigTwoWay(odds.away, odds.home) : null
  return {
    status: 'insufficient',
    reason,
    probabilityAway: null,
    probabilityHome: null,
    probabilityCalibratedAway: null,
    probabilityCalibratedHome: null,
    probabilityBlendedAway: market?.marketA ?? null,
    probabilityBlendedHome: market?.marketB ?? null,
    impliedAway,
    impliedHome,
    marketAway: market?.marketA ?? null,
    marketHome: market?.marketB ?? null,
    evAway: null,
    evHome: null,
    evBlendedAway: null,
    evBlendedHome: null,
    divergenceFlag: null,
    divergencePp: null,
    decision: { action: 'pass', side: null, reason },
  }
}

type BuildMarketOptions = {
  reliability?: CalibrationBin[]
  awayIsSideA?: boolean
  validationReady?: boolean
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
  blendConfig?: MarketBlendingConfig
  divergenceConfig?: DivergenceGuardConfig
  calibrationMode?: CalibrationMode
}

export const buildMarketQuote = (probabilityAway: number | null, options: BuildMarketOptions): MarketQuote => {
  if (probabilityAway === null) return emptyMarket(options.reason ?? '樣本不足', options.odds)

  const blendCfg = options.blendConfig ?? DEFAULT_MODEL_CONFIG.blending
  const divergeCfg = options.divergenceConfig ?? DEFAULT_MODEL_CONFIG.divergence
  const calMode = options.calibrationMode ?? DEFAULT_MODEL_CONFIG.calibration.mode

  const probabilityHome = 1 - probabilityAway

  const applyCalibration = (raw: number, bins: CalibrationBin[] | undefined, isSideA: boolean): number => {
    if (calMode === 'none') return raw
    if (calMode === 'mild') return mildCalibrate(raw, DEFAULT_MODEL_CONFIG.calibration.mildShrinkFactor)
    return calibrateSide(raw, bins, isSideA)
  }

  const probabilityCalibratedAway = applyCalibration(probabilityAway, options.calibration, options.awayIsSideA ?? true)
  const probabilityCalibratedHome = 1 - probabilityCalibratedAway
  const impliedAway = options.odds ? impliedProbability(options.odds.away) : null
  const impliedHome = options.odds ? impliedProbability(options.odds.home) : null
  const market = options.odds ? devigTwoWay(options.odds.away, options.odds.home) : null
  const marketAway = market?.marketA ?? null
  const marketHome = market?.marketB ?? null

  const probabilityBlendedAway = blendProbability(probabilityCalibratedAway, marketAway, blendCfg)
  const probabilityBlendedHome = probabilityBlendedAway !== null ? 1 - probabilityBlendedAway : null

  const evAway = options.odds ? expectedValue(probabilityCalibratedAway, options.odds.away) : null
  const evHome = options.odds ? expectedValue(probabilityCalibratedHome, options.odds.home) : null
  const evBlendedAway = options.odds && probabilityBlendedAway !== null ? expectedValue(probabilityBlendedAway, options.odds.away) : null
  const evBlendedHome = options.odds && probabilityBlendedHome !== null ? expectedValue(probabilityBlendedHome, options.odds.home) : null

  const divergence = checkDivergence(probabilityCalibratedAway, marketAway, divergeCfg)
  const divergenceFlag = divergence.diverges ? DIVERGENCE_FLAG : null
  const divergencePp = divergence.diffPp

  const canonicalP = options.awayIsSideA === false ? probabilityCalibratedHome : probabilityCalibratedAway
  const bin = options.reliability?.find(b => canonicalP >= b.lo && (canonicalP < b.hi || b.hi === 1) && b.n > 0 && b.actual !== null)
  const evidence = bin ? probabilityEvidence(bin.n, bin.actual!) : undefined
  const inverseEvidence = evidence ? { n: evidence.n, observed: 1 - evidence.observed, lower: 1 - evidence.upper, upper: 1 - evidence.lower } : undefined

  return {
    status: 'ok',
    calibrationApplied: calMode === 'full' && (options.calibration ?? []).some(b => b.n > 0 && b.actual !== null),
    validationReady: options.validationReady,
    evidenceAway: options.awayIsSideA === false ? inverseEvidence : evidence,
    evidenceHome: options.awayIsSideA === false ? evidence : inverseEvidence,
    reason: null,
    probabilityAway,
    probabilityHome,
    probabilityCalibratedAway,
    probabilityCalibratedHome,
    probabilityBlendedAway,
    probabilityBlendedHome,
    impliedAway,
    impliedHome,
    marketAway,
    marketHome,
    evAway,
    evHome,
    evBlendedAway,
    evBlendedHome,
    divergenceFlag,
    divergencePp,
    blendConfig: { marketWeight: blendCfg.marketWeight, modelWeight: blendCfg.modelWeight },
    decision: marketAction({
      evAway,
      evHome,
      evBlendedAway,
      evBlendedHome,
      probabilityAway: probabilityCalibratedAway,
      probabilityHome: probabilityCalibratedHome,
      probabilityBlendedAway,
      probabilityBlendedHome,
      marketAway,
      marketHome,
      minEv: options.minEv,
      sampleOk: options.sampleOk,
      dataLagOk: options.dataLagOk,
      staleOk: options.staleOk,
      isGame1: options.isGame1,
      validationReady: options.validationReady,
      awayName: options.awayName,
      homeName: options.homeName,
      diverging: divergence.diverges,
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

export type EmptyMultiOutcome = { key: string, label: string, odds: number }

export const emptyMultiMarket = (
  reason: string,
  options?: { line?: number | null, outcomes?: EmptyMultiOutcome[] },
): MultiMarketQuote => {
  const listed = options?.outcomes ?? []
  const market = listed.length > 0 ? devigMultiWay(listed.map(outcome => outcome.odds)) : null
  return {
    status: 'insufficient',
    reason,
    line: options?.line ?? null,
    summary: null,
    outcomes: listed.map((outcome, index) => ({
      key: outcome.key,
      label: outcome.label,
      odds: outcome.odds,
      probability: 0,
      probabilityCalibrated: 0,
      probabilityBlended: market?.[index] ?? null,
      implied: impliedProbability(outcome.odds),
      market: market?.[index] ?? null,
      ev: null,
      evBlended: null,
    })),
    decision: { action: 'pass', outcomeKey: null, reason },
    divergenceFlag: null,
  }
}

export const emptyTotalsMarket = (reason: string, totals: TotalOdds) =>
  emptyMultiMarket(reason, {
    line: totals.line,
    outcomes: [
      { key: 'over', label: `大 ${totals.line}`, odds: totals.over },
      { key: 'under', label: `小 ${totals.line}`, odds: totals.under },
    ],
  })

export const emptyHandicapMarket = (
  reason: string,
  handicap: HandicapOdds,
  awayName: string,
  homeName: string,
) => {
  const signed = (line: number) => (line > 0 ? `+${line}` : `${line}`)
  return emptyMultiMarket(reason, {
    line: handicap.awayLine,
    outcomes: [
      { key: 'away', label: `${awayName} ${signed(handicap.awayLine)}`, odds: handicap.away },
      { key: 'home', label: `${homeName} ${signed(-handicap.awayLine)}`, odds: handicap.home },
    ],
  })
}

export const emptyScoreMarket = (reason: string, scoreOdds: Record<string, number>) =>
  emptyMultiMarket(reason, {
    outcomes: Object.entries(scoreOdds).map(([key, odds]) => ({ key, label: key, odds })),
  })

type OutcomeInput = { key: string, label: string, probability: number }

type BuildMultiMarketOptions = {
  calibrationApplied?: boolean
  odds?: number[]
  calibrated: number[]
  line?: number | null
  summary?: string | null
  minEv: number
  sampleOk: boolean
  dataLagOk: boolean
  staleOk: boolean
  allowCandidate?: boolean
  blendConfig?: MarketBlendingConfig
  divergenceConfig?: DivergenceGuardConfig
}

export const buildMultiMarketQuote = (outcomes: OutcomeInput[], options: BuildMultiMarketOptions): MultiMarketQuote => {
  const blendCfg = options.blendConfig ?? DEFAULT_MODEL_CONFIG.blending
  const divergeCfg = options.divergenceConfig ?? DEFAULT_MODEL_CONFIG.divergence
  const market = options.odds ? devigMultiWay(options.odds) : null

  const quoted: OutcomeQuote[] = outcomes.map((outcome, index) => {
    const odds = options.odds?.[index] ?? null
    const probabilityCalibrated = options.calibrated[index] ?? outcome.probability
    const marketProb = market?.[index] ?? null
    const probabilityBlended = blendProbability(probabilityCalibrated, marketProb, blendCfg)
    return {
      ...outcome,
      odds,
      probabilityCalibrated,
      probabilityBlended,
      implied: odds === null ? null : impliedProbability(odds),
      market: marketProb,
      ev: odds === null ? null : expectedValue(probabilityCalibrated, odds),
      evBlended: odds === null || probabilityBlended === null ? null : expectedValue(probabilityBlended, odds),
    }
  })

  const checkOutcomeDivergence = () => {
    for (const q of quoted) {
      if (q.probabilityCalibrated !== undefined && q.market !== null) {
        const div = checkDivergence(q.probabilityCalibrated, q.market, divergeCfg)
        if (div.diverges) return true
      }
    }
    return false
  }
  const isDiverging = checkOutcomeDivergence()

  return {
    status: 'ok',
    reason: null,
    line: options.line ?? null,
    calibrationApplied: options.calibrationApplied,
    summary: options.summary ?? null,
    outcomes: quoted,
    divergenceFlag: isDiverging ? DIVERGENCE_FLAG : null,
    blendConfig: { marketWeight: blendCfg.marketWeight, modelWeight: blendCfg.modelWeight },
    decision: outcomeAction({
      outcomes: quoted.map(outcome => ({
        key: outcome.key,
        ev: outcome.ev,
        evBlended: outcome.evBlended,
        probability: outcome.probabilityCalibrated,
        probabilityBlended: outcome.probabilityBlended,
        market: outcome.market,
        name: outcome.label,
      })),
      minEv: options.minEv,
      sampleOk: options.sampleOk,
      dataLagOk: options.dataLagOk,
      staleOk: options.staleOk,
      caution: POINTS_CAUTION,
      allowCandidate: options.allowCandidate ?? false,
      diverging: isDiverging,
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
  awayIsSideA?: boolean
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
    calibrationApplied: (model.totalsCalibration ?? []).some(b => b.n > 0),
    line,
    summary: `預期總分 ${distributionMean(distribution.total).toFixed(1)}，模型 50% 線 ${fairLine(distribution.total)}（兩局與三局分數差很多，平均數不等於 50% 線）`,
    minEv: MIN_POINTS_CANDIDATE_EV,
    blendConfig: model.blendConfig,
    divergenceConfig: model.divergenceConfig,
  })
}

const quoteHandicap = (
  { distribution, awayName, homeName, model, quality, awayIsSideA = true }: PointsMarketContext,
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
    calibrated: [calibrateSide(probabilityAwayCovers, model.handicapCalibration, awayIsSideA), 1 - calibrateSide(probabilityAwayCovers, model.handicapCalibration, awayIsSideA)],
    calibrationApplied: (model.handicapCalibration ?? []).some(b => b.n > 0),
    line: awayLine,
    summary: `預期分差 ${awayName} ${signedLine(Number(expectedMargin.toFixed(1)))}，模型 50% 讓分線 ${signedLine(-fairLine(distribution.margin))}`,
    minEv: MIN_POINTS_CANDIDATE_EV,
    blendConfig: model.blendConfig,
    divergenceConfig: model.divergenceConfig,
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
      calibrationApplied: (model.correctScoreCalibration ?? []).some(b => b.n > 0),
      summary: '比數為客:主',
      minEv: MIN_POINTS_CANDIDATE_EV,
      blendConfig: model.blendConfig,
      divergenceConfig: model.divergenceConfig,
    },
  )
}

const quoteSetCount = (
  { distribution, quality, model }: PointsMarketContext,
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
      calibrationApplied: false,
      minEv: MIN_POINTS_CANDIDATE_EV,
      blendConfig: model.blendConfig,
      divergenceConfig: model.divergenceConfig,
    },
  )
}

const ratingForQuote = (
  player: PlayerOption,
  asOf: string,
  mode: ShrinkMode,
) => (
  effectiveRating(player.elo, player.matchCount, player.lastPlayedOn, asOf, mode)
)

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
  const matchMode = model.shrinkMode
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
  const pGame1SideA = predictFirstGame({ pMatch: pMatchSideA, eloDiff, formDiff }, model)
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
    const emptyFilled = (reason: string): PointsMarkets => ({
      totalPoints: odds.totals ? emptyTotalsMarket(reason, odds.totals) : null,
      pointsHandicap: odds.handicap ? emptyHandicapMarket(reason, odds.handicap, away.name, home.name) : null,
      correctScore: odds.correctScore ? emptyScoreMarket(reason, odds.correctScore) : null,
      set1TotalPoints: odds.set1Totals ? emptyTotalsMarket(reason, odds.set1Totals) : null,
      set1PointsHandicap: odds.set1Handicap ? emptyHandicapMarket(reason, odds.set1Handicap, away.name, home.name) : null,
      setCount: odds.setCount ? emptyScoreMarket(reason, odds.setCount) : null,
    })
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
      awayIsSideA,
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
      awayIsSideA,
      validationReady: model.validationReady,
      reliability: model.matchReliability,
      ...quality,
      odds: odds.match,
      reason: `任一方全場樣本少於 ${MIN_MATCH_SAMPLE} 場`,
      calibration: model.matchCalibration,
      minEv: MIN_CANDIDATE_EV,
      sampleOk: away.matchCount >= MIN_CANDIDATE_SAMPLE && home.matchCount >= MIN_CANDIDATE_SAMPLE,
      calibrationMode: model.calibrationMode,
      blendConfig: model.blendConfig,
      divergenceConfig: model.divergenceConfig,
    }),
    set1Winner: buildMarketQuote(set1Ready ? pGame1Away : null, {
      awayIsSideA,
      validationReady: model.game1ValidationReady ?? model.validationReady,
      reliability: model.game1Reliability,
      ...quality,
      odds: odds.game1,
      reason: `任一方第一局樣本少於 ${MIN_SET1_SAMPLE} 場`,
      calibration: model.game1Calibration,
      minEv: MIN_GAME1_CANDIDATE_EV,
      sampleOk: away.set1Count >= MIN_CANDIDATE_SAMPLE && home.set1Count >= MIN_CANDIDATE_SAMPLE,
      isGame1: true,
      calibrationMode: model.calibrationMode,
      blendConfig: model.blendConfig,
      divergenceConfig: model.divergenceConfig,
    }),
  }
}
