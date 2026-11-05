import type { BetMarket, QuoteResponse } from './types'

export const quoteSelection = (quote: QuoteResponse, market: BetMarket, key: string) => {
  if (market === 'match' || market === 'set1') {
    if (key !== 'away' && key !== 'home') return null
    const q = market === 'match' ? quote.matchWinner : quote.set1Winner
    const p = key === 'away' ? q.probabilityCalibratedAway : q.probabilityCalibratedHome
    const implied = key === 'away' ? q.impliedAway : q.impliedHome
    if (p === null || implied === null) return null
    return { line: null, probability: p, odds: Math.round(1 / implied * 1000) / 1000,
      marketProbability: key === 'away' ? q.marketAway : q.marketHome,
      action: q.decision.side === key ? q.decision.action : 'pass' as const }
  }
  const q = { totals: quote.totalPoints, handicap: quote.pointsHandicap, correctScore: quote.correctScore,
    setHandicap: quote.setHandicap, set1Totals: quote.set1TotalPoints, set1Handicap: quote.set1PointsHandicap, setCount: quote.setCount }[market]
  const outcome = q?.outcomes.find(o => o.key === key)
  if (!q || !outcome || outcome.odds === null) return null
  return { line: q.line, probability: outcome.probabilityCalibrated, odds: outcome.odds, marketProbability: outcome.market,
    action: q.decision.outcomeKey === key ? q.decision.action : 'pass' as const }
}
