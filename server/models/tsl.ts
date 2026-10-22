import { z } from 'zod'
import { isHalfLine } from '../../shared/decision'
import { CORRECT_SCORES, type BetMarket, type CorrectScore, type Discipline, type FixtureOdds } from '../../shared/types'

export const TSL_ORIGIN = 'https://www-talo-ssb-pr.sportslottery.com.tw'

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

export const tslDiscipline = (tournament: string): Discipline | null => {
  if (tournament.includes('男子單打')) return 'MS'
  if (tournament.includes('女子單打')) return 'WS'
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

const correctScoreOdds = (market: TslMarket | undefined) => {
  if (!market) return null
  const entries = CORRECT_SCORES.map((score) => {
    const selection = market.selections.find(item => clean(item.name) === score)
    return [score, selectionOdds(selection)] as const
  })
  if (entries.some(([, odds]) => odds === null)) return null
  return Object.fromEntries(entries) as Record<CorrectScore, number>
}

const parseTslMarkets = (markets: TslMarket[]): FixtureOdds => ({
  match: twoWay(pickMarket(markets, name => name === '不讓分')),
  game1: twoWay(pickMarket(markets, name => name === '[第1局]不讓分')),
  totals: totalsOdds(pickMarket(markets, name => name.startsWith('[總分]大小'))),
  handicap: handicapOdds(pickMarket(markets, name => name.startsWith('[總分]讓分'))),
  correctScore: correctScoreOdds(pickMarket(markets, name => name === '正確比數')),
})

export const fixtureOddsRows = (odds: FixtureOdds): TslOddsRow[] => {
  const rows: TslOddsRow[] = []
  if (odds.match) {
    rows.push({ market: 'match', outcomeKey: 'away', line: null, odds: odds.match.away })
    rows.push({ market: 'match', outcomeKey: 'home', line: null, odds: odds.match.home })
  }
  if (odds.game1) {
    rows.push({ market: 'game1', outcomeKey: 'away', line: null, odds: odds.game1.away })
    rows.push({ market: 'game1', outcomeKey: 'home', line: null, odds: odds.game1.home })
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
    for (const score of CORRECT_SCORES) {
      rows.push({ market: 'correctScore', outcomeKey: score, line: null, odds: odds.correctScore[score] })
    }
  }
  return rows
}

const toFixture = (event: TslEvent, english: Map<string, z.infer<typeof englishSchema>>): TslFixture | string => {
  const tournament = clean(event.tournamentname)
  const discipline = tslDiscipline(tournament)
  if (!discipline) return '不是男單或女單'
  const sportradarId = sportradarMatchId(event.externalreference)
  if (sportradarId === null) return '沒有 Sportradar 場次編號'
  const names = english.get(event.idfoevent)
  if (!names) return '沒有英文選手名'
  const startsAt = new Date(event.tsstart)
  if (Number.isNaN(startsAt.getTime())) return '開賽時間無法解析'

  const odds = parseTslMarkets(event.markets)
  return {
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
    rows: fixtureOddsRows(odds),
  }
}

export const parseTslPayload = (payload: TslPayload): TslParseResult => {
  const english = new Map(payload.english.map(entry => [entry.idfoevent, entry]))
  const fixtures: TslFixture[] = []
  const skipped: TslParseResult['skipped'] = []
  for (const raw of payload.events) {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) {
      skipped.push({ name: '未知場次', reason: '格式不符' })
      continue
    }
    if (parsed.data.idfosporttype !== 'BAD') continue
    const result = toFixture(parsed.data, english)
    if (typeof result !== 'string') {
      fixtures.push(result)
      continue
    }
    skipped.push({ name: clean(`${parsed.data.participantname_away} @ ${parsed.data.participantname_home}`), reason: result })
  }
  return { fixtures, skipped }
}
