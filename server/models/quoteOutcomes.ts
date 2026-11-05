import type { BetMarket, MarketQuote, MultiMarketQuote, QuoteResponse } from '../../shared/types'

export type QuoteOutcomeRow = {
  market: BetMarket
  outcomeKey: string
  outcomeLabel: string
  line: number | null
  modelRaw: number | null
  marketVigRemoved: number | null
  modelBlended: number | null
  blendWeightMarket: number | null
  blendWeightModel: number | null
  calibrationMode: string | null
  divergencePp: number | null
  odds: number | null
  decisionAction: string
  dataSufficient: boolean
}

const oddsFromImplied = (implied: number | null) =>
  implied && implied > 0 ? Math.round((1 / implied) * 1000) / 1000 : null

const winnerRows = (
  market: BetMarket,
  quote: MarketQuote,
  awayName: string,
  homeName: string,
  calibrationMode: string | null,
): QuoteOutcomeRow[] => [
  {
    market,
    outcomeKey: 'away',
    outcomeLabel: awayName,
    line: null,
    modelRaw: quote.probabilityAway,
    marketVigRemoved: quote.marketAway,
    modelBlended: quote.probabilityBlendedAway,
    blendWeightMarket: quote.blendConfig?.marketWeight ?? null,
    blendWeightModel: quote.blendConfig?.modelWeight ?? null,
    calibrationMode,
    divergencePp: quote.divergencePp,
    odds: oddsFromImplied(quote.impliedAway),
    decisionAction: quote.decision.side === 'away' ? quote.decision.action : 'pass',
    dataSufficient: quote.status === 'ok',
  },
  {
    market,
    outcomeKey: 'home',
    outcomeLabel: homeName,
    line: null,
    modelRaw: quote.probabilityHome,
    marketVigRemoved: quote.marketHome,
    modelBlended: quote.probabilityBlendedHome,
    blendWeightMarket: quote.blendConfig?.marketWeight ?? null,
    blendWeightModel: quote.blendConfig?.modelWeight ?? null,
    calibrationMode,
    divergencePp: quote.divergencePp,
    odds: oddsFromImplied(quote.impliedHome),
    decisionAction: quote.decision.side === 'home' ? quote.decision.action : 'pass',
    dataSufficient: quote.status === 'ok',
  },
]

const multiRows = (market: BetMarket, quote: MultiMarketQuote | null, calibrationMode: string | null): QuoteOutcomeRow[] => {
  if (!quote) return []
  return quote.outcomes.map(outcome => ({
    market,
    outcomeKey: outcome.key,
    outcomeLabel: outcome.label,
    line: quote.line,
    modelRaw: quote.status === 'ok' ? outcome.probability : null,
    marketVigRemoved: outcome.market,
    modelBlended: quote.status === 'ok' ? outcome.probabilityBlended : null,
    blendWeightMarket: quote.blendConfig?.marketWeight ?? null,
    blendWeightModel: quote.blendConfig?.modelWeight ?? null,
    calibrationMode,
    divergencePp: null,
    odds: outcome.odds,
    decisionAction: quote.decision.outcomeKey === outcome.key ? quote.decision.action : 'pass',
    dataSufficient: quote.status === 'ok',
  }))
}

export const quoteOutcomeRows = (quote: QuoteResponse): QuoteOutcomeRow[] => {
  const calMode = quote.calibrationMode ?? null
  return [
    ...winnerRows('match', quote.matchWinner, quote.away.name, quote.home.name, calMode),
    ...winnerRows('set1', quote.set1Winner, quote.away.name, quote.home.name, calMode),
    ...multiRows('totals', quote.totalPoints, calMode),
    ...multiRows('handicap', quote.pointsHandicap, calMode),
    ...multiRows('correctScore', quote.correctScore, calMode),
    ...multiRows('setHandicap', quote.setHandicap, calMode),
    ...multiRows('set1Totals', quote.set1TotalPoints, calMode),
    ...multiRows('set1Handicap', quote.set1PointsHandicap, calMode),
  ]
}
