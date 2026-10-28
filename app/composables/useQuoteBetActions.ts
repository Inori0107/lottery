import type {
  BetDraft,
  BetMarket,
  BetRecord,
  FixtureSummary,
  MarketSide,
  OutcomeQuote,
  QuoteResponse,
} from '~~/shared/types'
import { betMarketLabel } from '~~/shared/types'

const oddsFromImplied = (implied: number) => Math.round((1 / implied) * 1000) / 1000

const quoteBetBase = (quote: QuoteResponse, fixture: FixtureSummary | null) => {
  const sameSides = fixture
    && fixture.discipline === quote.discipline
    && (!fixture.away || fixture.away.id === quote.away.id)
    && (!fixture.home || fixture.home.id === quote.home.id)
  const fixtureId = sameSides ? fixture.sportradarId : null
  return {
    fixtureId,
    sport: quote.sport,
    discipline: quote.discipline,
    awayName: quote.away.name,
    homeName: quote.home.name,
    startsAt: fixtureId === null ? null : fixture?.startsAt ?? null,
    modelVersion: quote.modelVersion,
  }
}

const multiMarketOf = (quote: QuoteResponse, market: Exclude<BetMarket, 'match' | 'set1'>) => ({
  totals: quote.totalPoints,
  handicap: quote.pointsHandicap,
  correctScore: quote.correctScore,
  setHandicap: quote.setHandicap,
  set1Totals: quote.set1TotalPoints,
  set1Handicap: quote.set1PointsHandicap,
  setCount: quote.setCount,
}[market])

const winnerDraft = (
  quote: QuoteResponse | null,
  fixture: FixtureSummary | null,
  market: 'match' | 'set1',
  side: MarketSide,
): BetDraft | null => {
  if (!quote) return null
  const marketQuote = market === 'match' ? quote.matchWinner : quote.set1Winner
  const implied = side === 'away' ? marketQuote.impliedAway : marketQuote.impliedHome
  if (implied === null) return null
  return {
    ...quoteBetBase(quote, fixture),
    market,
    outcomeKey: side,
    outcomeLabel: side === 'away' ? quote.away.name : quote.home.name,
    line: null,
    odds: oddsFromImplied(implied),
    probability: side === 'away' ? marketQuote.probabilityCalibratedAway : marketQuote.probabilityCalibratedHome,
    ev: side === 'away' ? marketQuote.evAway : marketQuote.evHome,
    action: marketQuote.decision.side === side ? marketQuote.decision.action : 'pass',
  }
}

const outcomeDraft = (
  quote: QuoteResponse | null,
  fixture: FixtureSummary | null,
  market: Exclude<BetMarket, 'match' | 'set1'>,
  outcome: OutcomeQuote,
): BetDraft | null => {
  if (!quote || outcome.odds === null) return null
  const marketQuote = multiMarketOf(quote, market)
  if (!marketQuote) return null
  return {
    ...quoteBetBase(quote, fixture),
    market,
    outcomeKey: outcome.key,
    outcomeLabel: outcome.label,
    line: market === 'correctScore' || market === 'setCount' ? null : marketQuote.line,
    odds: outcome.odds,
    probability: outcome.probabilityCalibrated,
    ev: outcome.ev,
    action: marketQuote.decision.outcomeKey === outcome.key ? marketQuote.decision.action : 'pass',
  }
}

export const useQuoteBetActions = (
  result: Ref<QuoteResponse | null>,
  activeFixture: Ref<FixtureSummary | null>,
) => {
  const betDraft = ref<BetDraft | null>(null)
  const savedBetMessage = ref('')
  const { addLeg, message: slipMessage } = useParlaySlip()

  const handleRecordWinner = (market: 'match' | 'set1', side: MarketSide) => {
    const draft = winnerDraft(result.value, activeFixture.value, market, side)
    if (!draft) return
    savedBetMessage.value = ''
    betDraft.value = draft
  }

  const handleSlipWinner = (market: 'match' | 'set1', side: MarketSide) => {
    const draft = winnerDraft(result.value, activeFixture.value, market, side)
    if (draft) addLeg(draft)
  }

  const handleRecordOutcome = (market: Exclude<BetMarket, 'match' | 'set1'>, outcome: OutcomeQuote) => {
    const draft = outcomeDraft(result.value, activeFixture.value, market, outcome)
    if (!draft) return
    savedBetMessage.value = ''
    betDraft.value = draft
  }

  const handleSlipOutcome = (market: Exclude<BetMarket, 'match' | 'set1'>, outcome: OutcomeQuote) => {
    const draft = outcomeDraft(result.value, activeFixture.value, market, outcome)
    if (draft) addLeg(draft)
  }

  const handleCloseBetDialog = () => {
    betDraft.value = null
  }

  const handleBetSaved = (bet: BetRecord) => {
    betDraft.value = null
    savedBetMessage.value = `已記錄 ${betMarketLabel[bet.market]} ${bet.outcomeLabel}，賠率 ${bet.odds}，金額 ${bet.stake}。`
  }

  return {
    betDraft,
    savedBetMessage,
    slipMessage,
    handleRecordWinner,
    handleSlipWinner,
    handleRecordOutcome,
    handleSlipOutcome,
    handleCloseBetDialog,
    handleBetSaved,
  }
}
