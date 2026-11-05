import {
  BET_MARKETS,
  emptyFixtureOdds,
  type BetMarket,
  type FixtureMarket,
  type FixtureOdds,
  type FixtureSummary,
} from './types'

export const BADMINTON_MARKETS: BetMarket[] = [
  'match',
  'set1',
  'totals',
  'handicap',
  'set1Totals',
  'set1Handicap',
  'setCount',
  'correctScore',
]
export const MAX_ODDS_AGE_MS = 30 * 60_000

export const oddsForMarket = (entry: FixtureMarket): FixtureOdds => {
  const odds = emptyFixtureOdds()
  if (entry.status !== 'available' || !entry.market) return odds
  const values = Object.fromEntries(
    entry.selections.map((s) => [s.key, s.odds]),
  ) as Record<string, number>
  switch (entry.market) {
    case 'match':
    case 'set1':
      odds[entry.market] = { away: values.away!, home: values.home! }
      break
    case 'totals':
    case 'set1Totals':
      odds[entry.market] = {
        line: entry.line!,
        over: values.over!,
        under: values.under!,
      }
      break
    case 'handicap':
    case 'setHandicap':
    case 'set1Handicap':
      odds[entry.market] = {
        homeLine: -entry.line!,
        away: values.away!,
        home: values.home!,
      }
      break
    case 'correctScore':
      odds.correctScore = values
      break
    case 'setCount':
      odds.setCount = values
      break
  }
  return odds
}

export const defaultFixtureOdds = (markets: FixtureMarket[]): FixtureOdds => {
  const odds = emptyFixtureOdds()
  for (const kind of BET_MARKETS) {
    const available = markets.filter(
      (m) => m.market === kind && m.status === 'available',
    )
    const picked = available.find((m) => m.isMainline) ?? available[0]
    if (picked) Object.assign(odds, { [kind]: oddsForMarket(picked)[kind] })
  }
  return odds
}

export const marketIsOpen = (market: FixtureMarket, now: number) =>
  market.status === 'available' &&
  (!market.bettingEndsAt || Date.parse(market.bettingEndsAt) > now)

export const sourceForSelection = (
  fixture: FixtureSummary | null,
  kind: BetMarket,
  key: string,
  line: number | null,
  odds: number,
) => {
  const market = fixture?.markets?.find(
    (m) =>
      m.market === kind &&
      m.status === 'available' &&
      m.line === line &&
      m.selections.some((s) => s.key === key && s.odds === odds),
  )
  return {
    sourceMarketId: market?.id ?? null,
    oddsCapturedAt: market ? (fixture?.oddsCapturedAt ?? null) : null,
  }
}
