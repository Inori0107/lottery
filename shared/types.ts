import type {
  Sport,
  Discipline as SportDiscipline,
  BadmintonDiscipline,
  VolleyballDiscipline,
  FootballDiscipline,
  CorrectScore as SportCorrectScore,
} from './sports'

export type { Sport, BadmintonDiscipline, VolleyballDiscipline, FootballDiscipline }

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
export const FOOTBALL_CORRECT_SCORES = [
  '0:0', '1:0', '2:0', '3:0', '4:0',
  '0:1', '1:1', '2:1', '3:1', '4:1',
  '0:2', '1:2', '2:2', '3:2',
  '0:3', '1:3', '2:3',
  '0:4', '1:4',
  'other',
] as const
export const CORRECT_SCORES = BADMINTON_CORRECT_SCORES

export type CorrectScore = SportCorrectScore

export type Match1X2Outcome = 'home' | 'draw' | 'away'

export type MarketAction = 'pass' | 'watch' | 'candidate'

export type MarketSide = 'away' | 'home'

export type MarketDecision = {
  action: MarketAction
  side: MarketSide | null
  reason: string
}

export type Market1X2Decision = {
  action: MarketAction
  outcome: Match1X2Outcome | null
  reason: string
}

export type Market1X2Quote = {
  evidenceHome?: ProbabilityEvidence
  evidenceDraw?: ProbabilityEvidence
  evidenceAway?: ProbabilityEvidence
  calibrationApplied?: boolean
  validationReady?: boolean
  status: 'ok' | 'insufficient'
  reason: string | null
  probabilityHome: number | null
  probabilityDraw: number | null
  probabilityAway: number | null
  probabilityCalibratedHome: number | null
  probabilityCalibratedDraw: number | null
  probabilityCalibratedAway: number | null
  impliedHome: number | null
  impliedDraw: number | null
  impliedAway: number | null
  marketHome: number | null
  marketDraw: number | null
  marketAway: number | null
  evHome: number | null
  evDraw: number | null
  evAway: number | null
  decision: Market1X2Decision
}

export type ProbabilityEvidence = { n: number; observed: number; lower: number; upper: number }

export type MarketQuote = {
  evidenceAway?: ProbabilityEvidence
  evidenceHome?: ProbabilityEvidence
  calibrationApplied?: boolean
  validationReady?: boolean
  status: 'ok' | 'insufficient'
  reason: string | null
  probabilityAway: number | null
  probabilityHome: number | null
  probabilityCalibratedAway: number | null
  probabilityCalibratedHome: number | null
  /** 混合機率（市場+模型加權平均）*/
  probabilityBlendedAway: number | null
  probabilityBlendedHome: number | null
  impliedAway: number | null
  impliedHome: number | null
  marketAway: number | null
  marketHome: number | null
  evAway: number | null
  evHome: number | null
  /** 混合機率計算的 EV */
  evBlendedAway: number | null
  evBlendedHome: number | null
  /** 發散警示：模型與市場差距過大 */
  divergenceFlag: string | null
  /** 模型與市場差距（百分點）*/
  divergencePp: number | null
  decision: MarketDecision
  /** 使用的混合配置 */
  blendConfig?: { marketWeight: number; modelWeight: number }
}

export type OutcomeQuote = {
  key: string
  label: string
  odds: number | null
  probability: number
  probabilityCalibrated: number
  /** 混合機率 */
  probabilityBlended: number | null
  implied: number | null
  market: number | null
  ev: number | null
  /** 混合機率計算的 EV */
  evBlended: number | null
}

export type OutcomeDecision = {
  action: MarketAction
  outcomeKey: string | null
  reason: string
}

export type MultiMarketQuote = {
  calibrationApplied?: boolean
  status: 'ok' | 'insufficient'
  reason: string | null
  line: number | null
  summary: string | null
  outcomes: OutcomeQuote[]
  decision: OutcomeDecision
  /** 發散警示 */
  divergenceFlag: string | null
  /** 使用的混合配置 */
  blendConfig?: { marketWeight: number; modelWeight: number }
}

export type QuoteResponse = {
  quoteId?: string
  quotedAt?: string
  evaluationProtocol?: string | null
  marketSources?: Partial<Record<BetMarket, { marketId: string, capturedAt: string }>>
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
  setCount: MultiMarketQuote | null
  match1X2?: Market1X2Quote | null
  firstHalf1X2?: Market1X2Quote | null
  totalGoals?: MultiMarketQuote | null
  goalsHandicap?: MultiMarketQuote | null
  firstHalfTotals?: MultiMarketQuote | null
  firstHalfHandicap?: MultiMarketQuote | null
  expectedGoalsHome?: number | null
  expectedGoalsAway?: number | null
  /** 使用的模型配置摘要 */
  configSummary?: string
  /** 混合權重 */
  blendConfig?: { marketWeight: number; modelWeight: number }
  /** 校準模式 */
  calibrationMode?: 'none' | 'mild' | 'full'
}

export type BadmintonWatchlist = {
  threshold: number
  considered: number
  items: Array<{ fixture: FixtureSummary; side: MarketSide; probability: number; odds: number; quote: QuoteResponse; eligible: boolean; reasons: string[] }>
  skipped: Array<{ title: string; reason: string }>
}

export type LatestMatchInfo = {
  date: string | null
  staleWarning: string | null
}

export type StatusResponse = {
  ready: boolean
  dataThrough: string | null
  latestMatch: {
    badminton: { MS: LatestMatchInfo, WS: LatestMatchInfo }
    volleyball: { M: LatestMatchInfo, W: LatestMatchInfo }
  }
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
    football?: { FM: number, FW: number }
  }
  notes: string[]
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
  'setCount',
  'match1X2',
  'firstHalf1X2',
  'firstHalfTotals',
  'firstHalfHandicap',
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
  setCount: '正確總局數',
  match1X2: '不讓分（含和局）',
  firstHalf1X2: '上半場不讓分',
  firstHalfTotals: '上半場大小',
  firstHalfHandicap: '上半場讓分',
}

export const badmintonBetMarketLabel: Partial<Record<BetMarket, string>> = {
  set1: '第一局不讓分',
  set1Totals: '[第1局]大小',
  set1Handicap: '[第1局]讓分',
}

export const footballBetMarketLabel: Partial<Record<BetMarket, string>> = {
  match1X2: '不讓分（含和局）',
  totals: '大小球',
  handicap: '讓球',
  correctScore: '正確比分',
  firstHalf1X2: '上半場不讓分',
  firstHalfTotals: '上半場大小',
  firstHalfHandicap: '上半場讓球',
}

export const marketLabelFor = (sport: Sport, market: BetMarket) => {
  if (sport === 'badminton') return badmintonBetMarketLabel[market] ?? betMarketLabel[market]
  if (sport === 'football') return footballBetMarketLabel[market] ?? betMarketLabel[market]
  return betMarketLabel[market]
}

export type FixtureStatus = 'pre' | 'live' | 'ended' | 'void'

export type FixtureMarket = {
  id: string
  sourceTypeId: string | null
  market: BetMarket | null
  name: string
  line: number | null
  isMainline: boolean
  status: 'available' | 'unavailable' | 'unsupported' | 'invalid'
  reason: string | null
  bettingEndsAt: string | null
  sourceState: string | null
  bettingTypes: string | null
  selections: Array<{ id: string | null, key: string, label: string, odds: number | null, sourceState: string | null }>
}

export type FixtureOdds = {
  match: { away: number, home: number } | null
  set1: { away: number, home: number } | null
  totals: { line: number, over: number, under: number } | null
  handicap: { homeLine: number, away: number, home: number } | null
  correctScore: Partial<Record<CorrectScore, number>> | null
  setHandicap: { homeLine: number, away: number, home: number } | null
  set1Totals: { line: number, over: number, under: number } | null
  set1Handicap: { homeLine: number, away: number, home: number } | null
  setCount: Partial<Record<string, number>> | null
  match1X2: { home: number, draw: number, away: number } | null
  firstHalf1X2: { home: number, draw: number, away: number } | null
  firstHalfTotals: { line: number, over: number, under: number } | null
  firstHalfHandicap: { homeLine: number, away: number, home: number } | null
}

export const emptyFixtureOdds = (): FixtureOdds => ({
  match: null,
  set1: null,
  totals: null,
  handicap: null,
  correctScore: null,
  setHandicap: null,
  set1Totals: null,
  set1Handicap: null,
  setCount: null,
  match1X2: null,
  firstHalf1X2: null,
  firstHalfTotals: null,
  firstHalfHandicap: null,
})

export const fixturePresentMarkets = (odds: FixtureOdds): BetMarket[] =>
  BET_MARKETS.filter((market) => {
    const value = odds[market]
    if (value == null) return false
    return typeof value !== 'object' || Object.keys(value).length > 0
  })

export type MatchConfidence = 'confirmed' | 'pending'

export type FixtureSummary = {
  markets?: FixtureMarket[]
  sport: Sport
  sportradarId: number
  tslEventId: string
  discipline: Discipline
  tournament: string
  startsAt: string
  status: FixtureStatus
  score: string
  awayName: string
  homeName: string
  awayNameZh: string
  homeNameZh: string
  awayUid: number | null
  homeUid: number | null
  away: Participant | null
  home: Participant | null
  awaySuggested: Participant | null
  homeSuggested: Participant | null
  awayMatchStatus: MatchConfidence
  homeMatchStatus: MatchConfidence
  odds: FixtureOdds
  oddsCapturedAt: string | null
  isHome?: boolean
  ignoredMarkets?: string[]
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
  pending: number
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
  quoteId?: string | null
  marketProbability?: number | null
  sourceMarketId?: string | null
  oddsCapturedAt?: string | null
  id: string
  ticketId: string | null
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

export type TicketKind = 'single' | 'parlay'

export const LEDGER_KINDS = ['sim', 'real'] as const
export type LedgerKind = typeof LEDGER_KINDS[number]

export type TicketLegInput = {
  quoteId?: string | null
  sourceMarketId?: string | null
  oddsCapturedAt?: string | null
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
  probability: number | null
  ev: number | null
  action: BetAction | null
  modelVersion: string | null
  tournament?: string
  round?: string
  dataSufficient?: boolean
  probabilitySource?: 'model' | 'market'
}

export type TicketLeg = TicketLegInput & {
  marketProbability?: number | null
  clv?: number | null
  id: string
  status: BetStatus
  payout: number | null
}

export type TicketRecord = {
  archivedAt?: string | null
  strategy?: 'research' | 'conservative'
  id: string
  kind: TicketKind
  ledgerKind: LedgerKind
  stake: number
  combinedOdds: number
  combinedProbability: number | null
  ev: number | null
  status: BetStatus
  payout: number | null
  placedAt: string
  settledAt: string | null
  note: string
  legs: TicketLeg[]
}

export type BankrollRecord = {
  kind: LedgerKind
  starting: number
  balance: number
}

export type TicketsResponse = {
  tickets: TicketRecord[]
  bankroll: BankrollRecord
  stats?: import('./performance').PerformanceSummary
}

export type SlipLeg = TicketLegInput

export type ParlayQuote = {
  combinedOdds: number
  combinedProbability: number | null
  ev: number | null
  kelly: number | null
  reason: string | null
}
