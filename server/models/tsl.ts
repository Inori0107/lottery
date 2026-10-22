import { z } from 'zod'
import { isHalfLine } from '../../shared/decision'
import {
  BADMINTON_CORRECT_SCORES,
  VOLLEYBALL_CORRECT_SCORES,
  type BetMarket,
  type CorrectScore,
  type Discipline,
  type FixtureOdds,
  type Sport,
} from '../../shared/types'
import { SPORT_CONFIG, getSportByTslCode } from '../../shared/sports'

export const TSL_ORIGIN = 'https://www-talo-ssb-pr.sportslottery.com.tw'

export const TSL_SPORT_CODES = {
  badminton: 'BAD',
  volleyball: 'VOL',
} as const

const selectionSchema = z.object({
  name: z.string(),
  hadvalue: z.string().nullish(),
  currentpriceup: z.string().nullish(),
  currentpricedown: z.string().nullish(),
  currenthandicap: z.string().nullish(),
})

const marketSchema = z.object({
  name: z.string(),
  istradable: z.boolean().nullish(),
  ismainline: z.boolean().nullish(),
  selections: z.array(selectionSchema),
})

const eventSchema = z.object({
  idfoevent: z.string(),
  idfosporttype: z.string(),
  participantname_away: z.string(),
  participantname_home: z.string(),
  tsstart: z.string(),
  tournamentname: z.string(),
  externalreference: z.string().nullish(),
  markets: z.array(marketSchema),
})

const englishSchema = z.object({
  idfoevent: z.string(),
  participantname_away: z.string(),
  participantname_home: z.string(),
})

export const tslPayloadSchema = z.object({
  capturedAt: z.string(),
  date: z.string(),
  english: z.array(englishSchema),
  events: z.array(z.unknown()),
})

export type TslPayload = z.infer<typeof tslPayloadSchema>

type TslEvent = z.infer<typeof eventSchema>
type TslMarket = z.infer<typeof marketSchema>
type TslSelection = z.infer<typeof selectionSchema>

export type TslOddsRow = {
  market: BetMarket
  outcomeKey: string
  line: number | null
  odds: number
}

export type TslFixture = {
  sport: Sport
  tslEventId: string
  sportradarId: number
  discipline: Discipline
  tournament: string
  startsAt: string
  awayName: string
  homeName: string
  awayNameZh: string
  homeNameZh: string
  odds: FixtureOdds
  rows: TslOddsRow[]
}

export type TslParseResult = {
  fixtures: TslFixture[]
  skipped: Array<{ name: string, reason: string }>
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

export const tslBadmintonDiscipline = (tournament: string): Discipline | null => {
  if (tournament.includes('男子單打')) return 'MS'
  if (tournament.includes('女子單打')) return 'WS'
  return null
}

export const tslVolleyballDiscipline = (tournament: string): Discipline | null => {
  const lower = tournament.toLowerCase()
  if (lower.includes('男') || lower.includes('men') || lower.includes("men's")) return 'M'
  if (lower.includes('女') || lower.includes('women') || lower.includes("women's")) return 'W'
  return null
}

export const tslDiscipline = (sport: Sport, tournament: string): Discipline | null => {
  if (sport === 'badminton') return tslBadmintonDiscipline(tournament)
  if (sport === 'volleyball') return tslVolleyballDiscipline(tournament)
  return null
}

export const sportradarMatchId = (reference: string | null | undefined) => {
  const matched = reference?.match(/^sr:match:(\d+)$/)
  return matched ? Number(matched[1]) : null
}

export const fractionalToDecimal = (up: string | null | undefined, down: string | null | undefined) => {
  const numerator = Number(up)
  const denominator = Number(down)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  return Math.round((1 + numerator / denominator) * 100) / 100
}

const selectionOdds = (selection: TslSelection | undefined) =>
  selection ? fractionalToDecimal(selection.currentpriceup, selection.currentpricedown) : null

const bySide = (market: TslMarket, side: 'A' | 'H') =>
  market.selections.find(selection => selection.hadvalue === side)

const trailingLine = (name: string) => {
  const matched = clean(name).match(/([+-]?\d+(?:\.\d+)?)$/)
  return matched ? Number(matched[1]) : null
}

const pickMarket = (markets: TslMarket[], matches: (name: string) => boolean) => {
  const candidates = markets.filter(market => market.istradable !== false && matches(clean(market.name)))
  return candidates.find(market => market.ismainline) ?? candidates[0]
}

const twoWay = (market: TslMarket | undefined) => {
  if (!market) return null
  const away = selectionOdds(bySide(market, 'A'))
  const home = selectionOdds(bySide(market, 'H'))
  return away && home ? { away, home } : null
}

const totalsOdds = (market: TslMarket | undefined) => {
  if (!market) return null
  const over = market.selections.find(selection => clean(selection.name).startsWith('大'))
  const under = market.selections.find(selection => clean(selection.name).startsWith('小'))
  const line = Number(over?.currenthandicap ?? trailingLine(market.name))
  const overOdds = selectionOdds(over)
  const underOdds = selectionOdds(under)
  if (!isHalfLine(line) || line <= 0 || !overOdds || !underOdds) return null
  return { line, over: overOdds, under: underOdds }
}

const handicapOdds = (market: TslMarket | undefined) => {
  if (!market) return null
  const awaySelection = bySide(market, 'A')
  const homeSelection = bySide(market, 'H')
  const homeLine = trailingLine(homeSelection?.name ?? '') ?? trailingLine(market.name)
  const away = selectionOdds(awaySelection)
  const home = selectionOdds(homeSelection)
  if (homeLine === null || !isHalfLine(homeLine) || !away || !home) return null
  return { homeLine, away, home }
}

const correctScoreOdds = (market: TslMarket | undefined, scores: readonly CorrectScore[]) => {
  if (!market) return null
  const entries = scores.map((score) => {
    const selection = market.selections.find(item => clean(item.name) === score)
    return [score, selectionOdds(selection)] as const
  })
  const validEntries = entries.filter(([, odds]) => odds !== null)
  if (validEntries.length === 0) return null
  return Object.fromEntries(validEntries) as Partial<Record<CorrectScore, number>>
}

const parseBadmintonMarkets = (markets: TslMarket[]): FixtureOdds => ({
  match: twoWay(pickMarket(markets, name => name === '不讓分')),
  set1: twoWay(pickMarket(markets, name => name === '[第1局]不讓分')),
  totals: totalsOdds(pickMarket(markets, name => name.startsWith('[總分]大小'))),
  handicap: handicapOdds(pickMarket(markets, name => name.startsWith('[總分]讓分'))),
  correctScore: correctScoreOdds(pickMarket(markets, name => name === '正確比數'), BADMINTON_CORRECT_SCORES),
  setHandicap: null,
  set1Totals: null,
  set1Handicap: null,
})

const parseVolleyballMarkets = (markets: TslMarket[]): FixtureOdds => ({
  match: twoWay(pickMarket(markets, name => name === '不讓分')),
  set1: twoWay(pickMarket(markets, name => name === '[第1盤]不讓分' || name === '[第1局]不讓分')),
  totals: totalsOdds(pickMarket(markets, name => name.startsWith('[總分]大小'))),
  handicap: handicapOdds(pickMarket(markets, name => name.startsWith('[總分]讓分'))),
  correctScore: correctScoreOdds(pickMarket(markets, name => name === '正確比數'), VOLLEYBALL_CORRECT_SCORES),
  setHandicap: handicapOdds(pickMarket(markets, name => name.startsWith('局數讓分') || name.startsWith('[局數]讓分'))),
  set1Totals: totalsOdds(pickMarket(markets, name => name.startsWith('[第1盤]大小') || name.startsWith('[第1局]大小'))),
  set1Handicap: handicapOdds(pickMarket(markets, name => name.startsWith('[第1盤]讓分') || name.startsWith('[第1局]讓分'))),
})

const parseTslMarkets = (sport: Sport, markets: TslMarket[]): FixtureOdds => {
  if (sport === 'volleyball') return parseVolleyballMarkets(markets)
  return parseBadmintonMarkets(markets)
}

export const fixtureOddsRows = (odds: FixtureOdds, sport: Sport): TslOddsRow[] => {
  const rows: TslOddsRow[] = []
  if (odds.match) {
    rows.push({ market: 'match', outcomeKey: 'away', line: null, odds: odds.match.away })
    rows.push({ market: 'match', outcomeKey: 'home', line: null, odds: odds.match.home })
  }
  if (odds.set1) {
    rows.push({ market: 'set1', outcomeKey: 'away', line: null, odds: odds.set1.away })
    rows.push({ market: 'set1', outcomeKey: 'home', line: null, odds: odds.set1.home })
  }
  if (odds.totals) {
    rows.push({ market: 'totals', outcomeKey: 'over', line: odds.totals.line, odds: odds.totals.over })
    rows.push({ market: 'totals', outcomeKey: 'under', line: odds.totals.line, odds: odds.totals.under })
  }
  if (odds.handicap) {
    const awayLine = -odds.handicap.homeLine
    rows.push({ market: 'handicap', outcomeKey: 'away', line: awayLine, odds: odds.handicap.away })
    rows.push({ market: 'handicap', outcomeKey: 'home', line: awayLine, odds: odds.handicap.home })
  }
  if (odds.correctScore) {
    const scores = sport === 'volleyball' ? VOLLEYBALL_CORRECT_SCORES : BADMINTON_CORRECT_SCORES
    for (const score of scores) {
      const scoreOdds = odds.correctScore[score]
      if (scoreOdds !== undefined) {
        rows.push({ market: 'correctScore', outcomeKey: score, line: null, odds: scoreOdds })
      }
    }
  }
  if (odds.setHandicap) {
    const awayLine = -odds.setHandicap.homeLine
    rows.push({ market: 'setHandicap', outcomeKey: 'away', line: awayLine, odds: odds.setHandicap.away })
    rows.push({ market: 'setHandicap', outcomeKey: 'home', line: awayLine, odds: odds.setHandicap.home })
  }
  if (odds.set1Totals) {
    rows.push({ market: 'set1Totals', outcomeKey: 'over', line: odds.set1Totals.line, odds: odds.set1Totals.over })
    rows.push({ market: 'set1Totals', outcomeKey: 'under', line: odds.set1Totals.line, odds: odds.set1Totals.under })
  }
  if (odds.set1Handicap) {
    const awayLine = -odds.set1Handicap.homeLine
    rows.push({ market: 'set1Handicap', outcomeKey: 'away', line: awayLine, odds: odds.set1Handicap.away })
    rows.push({ market: 'set1Handicap', outcomeKey: 'home', line: awayLine, odds: odds.set1Handicap.home })
  }
  return rows
}

const toFixture = (
  event: TslEvent,
  sport: Sport,
  english: Map<string, z.infer<typeof englishSchema>>
): TslFixture | string => {
  const tournament = clean(event.tournamentname)
  const discipline = tslDiscipline(sport, tournament)
  if (!discipline) {
    if (sport === 'badminton') return '不是男單或女單'
    return '無法辨識男排或女排'
  }
  const sportradarId = sportradarMatchId(event.externalreference)
  if (sportradarId === null) return '沒有 Sportradar 場次編號'
  const names = english.get(event.idfoevent)
  if (!names) return '沒有英文隊伍名'
  const startsAt = new Date(event.tsstart)
  if (Number.isNaN(startsAt.getTime())) return '開賽時間無法解析'

  const odds = parseTslMarkets(sport, event.markets)
  return {
    sport,
    tslEventId: event.idfoevent,
    sportradarId,
    discipline,
    tournament,
    startsAt: startsAt.toISOString(),
    awayName: clean(names.participantname_away),
    homeName: clean(names.participantname_home),
    awayNameZh: clean(event.participantname_away),
    homeNameZh: clean(event.participantname_home),
    odds,
    rows: fixtureOddsRows(odds, sport),
  }
}

export type TslParseOptions = {
  sports?: Sport[]
}

export const parseTslPayload = (payload: TslPayload, options: TslParseOptions = {}): TslParseResult => {
  const { sports = ['badminton', 'volleyball'] } = options
  const english = new Map(payload.english.map(entry => [entry.idfoevent, entry]))
  const fixtures: TslFixture[] = []
  const skipped: TslParseResult['skipped'] = []

  for (const raw of payload.events) {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) {
      skipped.push({ name: '未知場次', reason: '格式不符' })
      continue
    }

    const sportCode = parsed.data.idfosporttype
    const sport = getSportByTslCode(sportCode)

    if (!sport || !sports.includes(sport)) continue

    const result = toFixture(parsed.data, sport, english)
    if (typeof result !== 'string') {
      fixtures.push(result)
      continue
    }
    skipped.push({
      name: clean(`${parsed.data.participantname_away} @ ${parsed.data.participantname_home}`),
      reason: result,
    })
  }
  return { fixtures, skipped }
}

export const parseBadmintonPayload = (payload: TslPayload): TslParseResult =>
  parseTslPayload(payload, { sports: ['badminton'] })

export const parseVolleyballPayload = (payload: TslPayload): TslParseResult =>
  parseTslPayload(payload, { sports: ['volleyball'] })
