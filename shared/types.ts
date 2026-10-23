import type {
  Sport,
  Discipline as SportDiscipline,
  BadmintonDiscipline,
  VolleyballDiscipline,
  TennisDiscipline,
  CorrectScore as SportCorrectScore,
} from './sports'

export type { Sport, BadmintonDiscipline, VolleyballDiscipline, TennisDiscipline }

export type Discipline = SportDiscipline

export type MarketType = 'match_winner' | 'set1_winner'

export type Split = 'train' | 'valid' | 'test'

export type Set1Method = 'logistic' | 'bins' | 'bo3' | 'bo5'
export type Game1Method = Set1Method

export type PlayerOption = {
  id: string
  name: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
}

export type TeamOption = {
  id: string
  name: string
  elo: number
  matchCount: number
  set1Count: number
  lastPlayedOn: string | null
  homeAdvantage: number
  rosterStrength: number
}

export type Participant = PlayerOption | TeamOption

export const isTeamOption = (p: Participant): p is TeamOption =>
  'homeAdvantage' in p && 'rosterStrength' in p

export const BADMINTON_CORRECT_SCORES = ['2:0', '2:1', '1:2', '0:2'] as const
export const VOLLEYBALL_CORRECT_SCORES = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3'] as const
export const TENNIS_BO3_CORRECT_SCORES = ['2:0', '2:1', '1:2', '0:2'] as const
export const TENNIS_BO5_CORRECT_SCORES = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3'] as const
export const TENNIS_CORRECT_SCORES = TENNIS_BO3_CORRECT_SCORES
export const CORRECT_SCORES = BADMINTON_CORRECT_SCORES

export type CorrectScore = SportCorrectScore

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
  sport: Sport
  discipline: Discipline
  modelVersion: string
  set1Method: Set1Method
  dataThrough: string
  asOf: string
  shrinkEnabled: boolean
  sourceUrl: string
  away: Participant
  home: Participant
  isHome: boolean
  warnings: string[]
  matchWinner: MarketQuote
  set1Winner: MarketQuote
  totalPoints: MultiMarketQuote | null
  pointsHandicap: MultiMarketQuote | null
  correctScore: MultiMarketQuote | null
  setHandicap: MultiMarketQuote | null
  set1TotalPoints: MultiMarketQuote | null
  set1PointsHandicap: MultiMarketQuote | null
}

export type StatusResponse = {
  ready: boolean
  dataThrough: string | null
  models: Array<{
    sport: Sport
    discipline: Discipline
    modelVersion: string
    set1Method: string
    dataThrough: string
  }>
  counts: {
    badminton: { MS: number, WS: number }
    volleyball: { M: number, W: number }
    tennis: { ATP: number, WTA: number }
  }
}

export const BET_MARKETS = [
  'match',
  'set1',
  'totals',
  'handicap',
  'correctScore',
  'setHandicap',
  'set1Totals',
  'set1Handicap',
] as const

export type BetMarket = typeof BET_MARKETS[number]

export const betMarketLabel: Record<BetMarket, string> = {
  match: '全場不讓分',
  set1: '第1盤不讓分',
  totals: '[總分]大小',
  handicap: '[總分]讓分',
  correctScore: '正確比數',
  setHandicap: '局數讓分',
  set1Totals: '[第1盤]大小',
  set1Handicap: '[第1盤]讓分',
}

export const badmintonBetMarketLabel: Partial<Record<BetMarket, string>> = {
  set1: '第一局不讓分',
}

export const tennisBetMarketLabel: Partial<Record<BetMarket, string>> = {
  set1: '[第1盤]不讓分',
  totals: '[總局數]大小',
  handicap: '[總局數]讓分',
  setHandicap: '盤數讓分',
  set1Totals: '[第1盤]大小',
  set1Handicap: '[第1盤]讓分',
}

export const marketLabelFor = (sport: Sport, market: BetMarket) => {
  if (sport === 'badminton') return badmintonBetMarketLabel[market] ?? betMarketLabel[market]
  if (sport === 'tennis') return tennisBetMarketLabel[market] ?? betMarketLabel[market]
  return betMarketLabel[market]
}

export type FixtureStatus = 'pre' | 'live' | 'ended' | 'void'

export type FixtureOdds = {
  match: { away: number, home: number } | null
  set1: { away: number, home: number } | null
  totals: { line: number, over: number, under: number } | null
  handicap: { homeLine: number, away: number, home: number } | null
  correctScore: Partial<Record<CorrectScore, number>> | null
  setHandicap: { homeLine: number, away: number, home: number } | null
  set1Totals: { line: number, over: number, under: number } | null
  set1Handicap: { homeLine: number, away: number, home: number } | null
}

export type FixtureSummary = {
  sport: Sport
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
  away: Participant | null
  home: Participant | null
  odds: FixtureOdds
  oddsCapturedAt: string | null
  isHome?: boolean
}

export type TslSkipReason = {
  name: string
  reason: string
}

export type TslImportSummary = {
  received: number
  imported: number
  fixtures: number
  snapshots: number
  skipped: TslSkipReason[]
  unlinked: string[]
  couponDate: string
}

export type FixturesResponse = {
  date: string
  lastImportAt: string | null
  lastImportSummary?: TslImportSummary | null
  fixtures: FixtureSummary[]
  message?: string | null
}

export const BET_STATUSES = ['open', 'won', 'lost', 'void'] as const

export type BetStatus = typeof BET_STATUSES[number]

export type BetAction = MarketAction

export type BetRecord = {
  id: string
  fixtureId: number | null
  sport: Sport
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
  sport: Sport
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
