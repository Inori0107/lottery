export type Discipline = 'MS' | 'WS'

export type MarketType = 'match_winner' | 'game1_winner'

export type Split = 'train' | 'valid' | 'test'

export type Game1Method = 'logistic' | 'bins' | 'bo3'

export type PlayerOption = {
  id: string
  name: string
  elo: number
  matchCount: number
  game1Count: number
  lastPlayedOn: string | null
}

export const CORRECT_SCORES = ['2:0', '2:1', '1:2', '0:2'] as const

export type CorrectScore = typeof CORRECT_SCORES[number]

export type MarketAction = 'pass' | 'watch' | 'candidate'

export type MarketSide = 'away' | 'home'

export type MarketDecision = {
  action: MarketAction
  side: MarketSide | null
  reason: string
}

export type MarketQuote = {
  status: 'ok' | 'insufficient'
  reason: string | null
  probabilityAway: number | null
  probabilityHome: number | null
  probabilityCalibratedAway: number | null
  probabilityCalibratedHome: number | null
  impliedAway: number | null
  impliedHome: number | null
  marketAway: number | null
  marketHome: number | null
  evAway: number | null
  evHome: number | null
  decision: MarketDecision
}

export type OutcomeQuote = {
  key: string
  label: string
  odds: number | null
  probability: number
  probabilityCalibrated: number
  implied: number | null
  market: number | null
  ev: number | null
}

export type OutcomeDecision = {
  action: MarketAction
  outcomeKey: string | null
  reason: string
}

export type MultiMarketQuote = {
  status: 'ok' | 'insufficient'
  reason: string | null
  line: number | null
  summary: string | null
  outcomes: OutcomeQuote[]
  decision: OutcomeDecision
}

export type QuoteResponse = {
  discipline: Discipline
  modelVersion: string
  game1Method: Game1Method
  dataThrough: string
  asOf: string
  shrinkEnabled: boolean
  sourceUrl: string
  away: PlayerOption
  home: PlayerOption
  warnings: string[]
  matchWinner: MarketQuote
  game1Winner: MarketQuote
  totalPoints: MultiMarketQuote | null
  pointsHandicap: MultiMarketQuote | null
  correctScore: MultiMarketQuote | null
}

export type StatusResponse = {
  ready: boolean
  dataThrough: string | null
  models: Array<{
    discipline: Discipline
    modelVersion: string
    game1Method: string
    dataThrough: string
  }>
  counts: { MS: number, WS: number }
}

export const BET_MARKETS = ['match', 'game1', 'totals', 'handicap', 'correctScore'] as const

export type BetMarket = typeof BET_MARKETS[number]

export const betMarketLabel: Record<BetMarket, string> = {
  match: '全場不讓分',
  game1: '第一局不讓分',
  totals: '[總分]大小',
  handicap: '[總分]讓分',
  correctScore: '正確比數',
}

export type FixtureStatus = 'pre' | 'live' | 'ended' | 'void'

export type FixtureOdds = {
  match: { away: number, home: number } | null
  game1: { away: number, home: number } | null
  totals: { line: number, over: number, under: number } | null
  handicap: { homeLine: number, away: number, home: number } | null
  correctScore: Record<CorrectScore, number> | null
}

export type FixtureSummary = {
  sportradarId: number
  discipline: Discipline
  tournament: string
  startsAt: string
  status: FixtureStatus
  score: string
  awayName: string
  homeName: string
  awayNameZh: string
  homeNameZh: string
  away: PlayerOption | null
  home: PlayerOption | null
  odds: FixtureOdds
  oddsCapturedAt: string | null
}

export type FixturesResponse = {
  date: string
  lastImportAt: string | null
  fixtures: FixtureSummary[]
}

export const BET_STATUSES = ['open', 'won', 'lost', 'void'] as const

export type BetStatus = typeof BET_STATUSES[number]

export type BetAction = MarketAction

export type BetRecord = {
  id: string
  fixtureId: number | null
  discipline: Discipline
  awayName: string
  homeName: string
  startsAt: string | null
  market: BetMarket
  outcomeKey: string
  outcomeLabel: string
  line: number | null
  odds: number
  stake: number
  placedAt: string
  modelVersion: string | null
  probability: number | null
  ev: number | null
  action: BetAction | null
  status: BetStatus
  payout: number | null
  closingOdds: number | null
  closingMarket: number | null
  clv: number | null
  settledAt: string | null
  note: string
}

export type BetStats = {
  count: number
  open: number
  won: number
  lost: number
  void: number
  winRate: number | null
  staked: number
  profit: number
  roi: number | null
  averageEv: number | null
  averageClv: number | null
  positiveClvRate: number | null
}

export type BetsResponse = {
  bets: BetRecord[]
  summary: {
    all: BetStats
    byMarket: Array<{ market: BetMarket, stats: BetStats }>
    byAction: Array<{ action: BetAction | 'none', stats: BetStats }>
  }
}

export type NewBetInput = {
  fixtureId: number | null
  discipline: Discipline
  awayName: string
  homeName: string
  startsAt: string | null
  market: BetMarket
  outcomeKey: string
  outcomeLabel: string
  line: number | null
  odds: number
  stake: number
  modelVersion: string | null
  probability: number | null
  ev: number | null
  action: BetAction | null
  note?: string
}

export type BetDraft = Omit<NewBetInput, 'stake' | 'note'>
