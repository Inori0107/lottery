import { parlayProbabilityFromQuote, type ParlayLeg } from '~~/shared/parlay'
import type { BetMarket, FixtureSummary, MarketQuote, MarketSide, OutcomeQuote, QuoteResponse } from '~~/shared/types'

const oddsFromImplied = (implied: number | null) =>
  implied && implied > 0 ? Math.round((1 / implied) * 1000) / 1000 : null

export const parlayLegFromWinner = (
  quote: QuoteResponse,
  fixture: FixtureSummary | null,
  market: 'match' | 'set1',
  side: MarketSide,
): ParlayLeg | null => {
  const marketQuote: MarketQuote = market === 'match' ? quote.matchWinner : quote.set1Winner
  const implied = side === 'away' ? marketQuote.impliedAway : marketQuote.impliedHome
  const odds = oddsFromImplied(implied)
  if (odds === null) return null
  const picked = parlayProbabilityFromQuote(
    marketQuote.status === 'ok',
    side === 'away' ? marketQuote.probabilityCalibratedAway : marketQuote.probabilityCalibratedHome,
    side === 'away' ? marketQuote.marketAway : marketQuote.marketHome,
  )
  const fixtureId = fixture?.sportradarId ?? null
  return {
    id: `${fixtureId ?? quote.away.id}:${market}:${side}`,
    fixtureId,
    sport: quote.sport,
    discipline: quote.discipline,
    tournament: fixture?.tournament ?? '',
    round: '',
    awayName: quote.away.name,
    homeName: quote.home.name,
    market,
    outcomeKey: side,
    outcomeLabel: side === 'away' ? quote.away.name : quote.home.name,
    line: null,
    odds,
    startsAt: fixture?.startsAt ?? null,
    ...picked,
  }
}

export const parlayLegFromOutcome = (
  quote: QuoteResponse,
  fixture: FixtureSummary | null,
  market: Exclude<BetMarket, 'match' | 'set1'>,
  outcome: OutcomeQuote,
  line: number | null,
  sufficient: boolean,
): ParlayLeg | null => {
  if (outcome.odds === null) return null
  const picked = parlayProbabilityFromQuote(
    sufficient,
    sufficient ? outcome.probabilityCalibrated : null,
    outcome.market,
  )
  const fixtureId = fixture?.sportradarId ?? null
  return {
    id: `${fixtureId ?? quote.away.id}:${market}:${outcome.key}:${line ?? ''}`,
    fixtureId,
    sport: quote.sport,
    discipline: quote.discipline,
    tournament: fixture?.tournament ?? '',
    round: '',
    awayName: quote.away.name,
    homeName: quote.home.name,
    market,
    outcomeKey: outcome.key,
    outcomeLabel: outcome.label,
    line,
    odds: outcome.odds,
    startsAt: fixture?.startsAt ?? null,
    ...picked,
  }
}
