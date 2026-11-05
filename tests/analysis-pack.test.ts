import { describe, expect, it } from 'vitest'
import { formatAnalysisPack, INSUFFICIENT_MODEL_FLAG } from '../shared/analysisPack'
import { emptyMarket, emptyTotalsMarket, quotePlayersWithForm } from '../server/models/quote'
import { oddsOnlyQuote } from '../server/models/analysisPack'
import { buildBins } from '../server/models/game1'
import type { FixtureSummary, QuoteResponse } from '../shared/types'

const binsModel = {
  method: 'bins' as const,
  coefficients: [0, 0, 0] as [number, number, number],
  bins: buildBins([]),
  shrinkMode: 'raw' as const,
}

const fixture = (overrides: Partial<FixtureSummary> = {}): FixtureSummary => ({
  sport: 'badminton',
  sportradarId: 12345,
  tslEventId: 'evt-99',
  discipline: 'MS',
  tournament: 'French Open',
  startsAt: '2026-10-22T10:00:00.000Z',
  status: 'pre',
  score: '',
  awayName: 'Viktor AXELSEN',
  homeName: 'Kodai NARAOKA',
  awayNameZh: '安賽龍',
  homeNameZh: '奈良岡功大',
  awayUid: 777,
  homeUid: 888,
  away: { id: 'p-away', name: 'Viktor AXELSEN', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2026-01-01' },
  home: { id: 'p-home', name: 'Kodai NARAOKA', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2026-01-01' },
  awaySuggested: null,
  homeSuggested: null,
  awayMatchStatus: 'confirmed',
  homeMatchStatus: 'confirmed',
  odds: {
    match: { away: 1.8, home: 2.0 },
    set1: { away: 1.7, home: 2.1 },
    totals: { line: 80.5, over: 1.9, under: 1.9 },
    handicap: null,
    correctScore: null,
    setHandicap: null,
    set1Totals: null,
    set1Handicap: null,
  },
  oddsCapturedAt: '2026-10-22T08:01:00.000Z',
  ...overrides,
})

describe('分析包', () => {
  it('資料不足時仍列出賠率、去水機率與旗標', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01', game1Recent: [0] },
      binsModel,
      { match: { away: 1.8, home: 2 }, totals: { line: 80.5, over: 1.91, under: 1.91 } },
      '2024-01-01',
    )
    const quote: QuoteResponse = {
      sport: 'badminton',
      discipline: 'MS',
      modelVersion: 'ms-test',
      set1Method: 'bins',
      dataThrough: '2024-01-01',
      asOf: '2024-01-01',
      shrinkEnabled: false,
      sourceUrl: 'test',
      away: { id: 'a', name: 'A', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01' },
      home: { id: 'b', name: 'B', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01' },
      isHome: false,
      warnings: [],
      matchWinner: quoted.matchWinner,
      set1Winner: quoted.set1Winner,
      totalPoints: quoted.totalPoints,
      pointsHandicap: quoted.pointsHandicap,
      correctScore: quoted.correctScore,
      setHandicap: null,
      set1TotalPoints: null,
      set1PointsHandicap: null,
    }
    const text = formatAnalysisPack({ quote, fixture: fixture() })
    expect(quoted.matchWinner.status).toBe('insufficient')
    expect(quoted.matchWinner.marketAway).toBeCloseTo(2 / 3.8, 5)
    expect(quoted.totalPoints?.outcomes).toHaveLength(2)
    expect(text).toContain(INSUFFICIENT_MODEL_FLAG)
    expect(text).toContain('運彩場次：evt-99')
    expect(text).toContain('Sportradar：12345')
    expect(text).toContain('n全場=1')
    expect(text).toContain('去水')
    expect(text).toContain('大 80.5')
    expect(text).toContain('模型：ms-test')
  })

  it('沒有模型時仍能從對局賠率組出分析包', () => {
    const pending = fixture({
      away: null,
      home: null,
      awayMatchStatus: 'pending',
      homeMatchStatus: 'pending',
    })
    const quote = oddsOnlyQuote(pending)
    const text = formatAnalysisPack({ quote, fixture: pending })
    expect(quote.matchWinner.impliedAway).toBeCloseTo(1 / 1.8)
    expect(text).toContain(INSUFFICIENT_MODEL_FLAG)
    expect(text).toContain('待確認')
    expect(text).toContain('安賽龍')
  })

  it('資料充足時並陳原始機率、校準與去水', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-01-01', game1Recent: [1, 1, 1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-01-01', game1Recent: [0, 0, 0] },
      binsModel,
      { match: { away: 1.5, home: 2.6 } },
      '2024-01-01',
    )
    expect(quoted.matchWinner.status).toBe('ok')
    expect(quoted.matchWinner.probabilityAway).not.toBeNull()
    const quote: QuoteResponse = {
      sport: 'badminton',
      discipline: 'MS',
      modelVersion: 'ms-test',
      set1Method: 'bins',
      dataThrough: '2024-01-01',
      asOf: '2024-01-01',
      shrinkEnabled: false,
      sourceUrl: 'test',
      away: { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-01-01' },
      home: { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-01-01' },
      isHome: false,
      warnings: [],
      matchWinner: quoted.matchWinner,
      set1Winner: quoted.set1Winner,
      totalPoints: null,
      pointsHandicap: null,
      correctScore: null,
      setHandicap: null,
      set1TotalPoints: null,
      set1PointsHandicap: null,
    }
    const text = formatAnalysisPack({ quote, fixture: fixture({ away: quote.away, home: quote.home }) })
    expect(text).toContain('模型資料充足')
    expect(text).toContain('模型原始')
    expect(text).not.toContain('旗標：模型資料不足')
  })
})

describe('資料不足市場仍保留去水', () => {
  it('emptyMarket 帶入雙方賠率', () => {
    const quote = emptyMarket('樣本不足', { away: 1.8, home: 2 })
    expect(quote.status).toBe('insufficient')
    expect(quote.probabilityAway).toBeNull()
    expect(quote.impliedAway).toBeCloseTo(1 / 1.8)
    expect(quote.marketAway).toBeCloseTo(2 / 3.8)
  })

  it('emptyTotalsMarket 帶入大小賠率', () => {
    const quote = emptyTotalsMarket('樣本不足', { line: 175.5, over: 1.9, under: 1.9 })
    expect(quote.outcomes).toHaveLength(2)
    expect(quote.outcomes[0]?.market).toBeCloseTo(0.5)
    expect(quote.outcomes[0]?.ev).toBeNull()
  })
})

describe('分析包顯示選手最近比賽日期', () => {
  it('顯示各選手 lastPlayedOn', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-01', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-03', game1Recent: [0] },
      binsModel,
      { match: { away: 1.5, home: 2.6 } },
      '2024-10-05',
    )
    const quote: QuoteResponse = {
      sport: 'badminton',
      discipline: 'MS',
      modelVersion: 'ms-test',
      set1Method: 'bins',
      dataThrough: '2024-10-05',
      asOf: '2024-10-05',
      shrinkEnabled: false,
      sourceUrl: 'test',
      away: { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-01' },
      home: { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-03' },
      isHome: false,
      warnings: [],
      matchWinner: quoted.matchWinner,
      set1Winner: quoted.set1Winner,
      totalPoints: null,
      pointsHandicap: null,
      correctScore: null,
      setHandicap: null,
      set1TotalPoints: null,
      set1PointsHandicap: null,
    }
    const text = formatAnalysisPack({ quote, fixture: fixture({ away: quote.away, home: quote.home }) })
    expect(text).toContain('最近比賽=2024-10-01')
    expect(text).toContain('最近比賽=2024-10-03')
  })

  it('選手超過警戒天數時顯示警告', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-09-01', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-10', game1Recent: [0] },
      binsModel,
      { match: { away: 1.5, home: 2.6 } },
      '2024-10-15',
    )
    const quote: QuoteResponse = {
      sport: 'badminton',
      discipline: 'MS',
      modelVersion: 'ms-test',
      set1Method: 'bins',
      dataThrough: '2024-10-15',
      asOf: '2024-10-15',
      shrinkEnabled: false,
      sourceUrl: 'test',
      away: { id: 'a', name: 'A', elo: 1700, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-09-01' },
      home: { id: 'b', name: 'B', elo: 1500, matchCount: 80, set1Count: 80, lastPlayedOn: '2024-10-10' },
      isHome: false,
      warnings: [],
      matchWinner: quoted.matchWinner,
      set1Winner: quoted.set1Winner,
      totalPoints: null,
      pointsHandicap: null,
      correctScore: null,
      setHandicap: null,
      set1TotalPoints: null,
      set1PointsHandicap: null,
    }
    const text = formatAnalysisPack({ quote, fixture: fixture({ away: quote.away, home: quote.home }) })
    expect(text).toContain('最近比賽=2024-09-01')
    expect(text).toContain('⚠ 最近比賽距今 44 天')
    expect(text).toContain('最近比賽=2024-10-10')
    expect(text).not.toContain('最近比賽距今 5 天')
  })
})
