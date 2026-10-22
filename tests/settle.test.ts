import { describe, expect, it } from 'vitest'
import type { BetRecord } from '../shared/types'
import {
  betPayout,
  closingLineValue,
  closingOdds,
  formatGameScores,
  parseGameScores,
  settleBet,
  summarizeBets,
} from '../server/models/settle'

const threeGames = parseGameScores('21-18 15-21 21-19')
const straightGames = parseGameScores('18-21 19-21')

describe('game scores', () => {
  it('round-trips away-home game scores', () => {
    expect(threeGames).toEqual([{ away: 21, home: 18 }, { away: 15, home: 21 }, { away: 21, home: 19 }])
    expect(formatGameScores(threeGames)).toBe('21-18 15-21 21-19')
  })
})

describe('settleBet', () => {
  it('settles the match winner', () => {
    expect(settleBet({ market: 'match', outcomeKey: 'away', line: null }, threeGames)).toBe('won')
    expect(settleBet({ market: 'match', outcomeKey: 'home', line: null }, threeGames)).toBe('lost')
  })

  it('settles the first game winner', () => {
    expect(settleBet({ market: 'game1', outcomeKey: 'away', line: null }, threeGames)).toBe('won')
    expect(settleBet({ market: 'game1', outcomeKey: 'home', line: null }, straightGames)).toBe('won')
  })

  it('settles totals against the line', () => {
    expect(settleBet({ market: 'totals', outcomeKey: 'over', line: 114.5 }, threeGames)).toBe('won')
    expect(settleBet({ market: 'totals', outcomeKey: 'under', line: 114.5 }, threeGames)).toBe('lost')
    expect(settleBet({ market: 'totals', outcomeKey: 'over', line: null }, threeGames)).toBe('void')
  })

  it('settles handicap with the away line', () => {
    expect(settleBet({ market: 'handicap', outcomeKey: 'away', line: 8.5 }, straightGames)).toBe('won')
    expect(settleBet({ market: 'handicap', outcomeKey: 'home', line: 8.5 }, straightGames)).toBe('lost')
    expect(settleBet({ market: 'handicap', outcomeKey: 'away', line: 2.5 }, straightGames)).toBe('lost')
  })

  it('settles correct score as away:home games', () => {
    expect(settleBet({ market: 'correctScore', outcomeKey: '2:1', line: null }, threeGames)).toBe('won')
    expect(settleBet({ market: 'correctScore', outcomeKey: '0:2', line: null }, straightGames)).toBe('won')
    expect(settleBet({ market: 'correctScore', outcomeKey: '2:0', line: null }, straightGames)).toBe('lost')
  })

  it('voids incomplete matches', () => {
    expect(settleBet({ market: 'match', outcomeKey: 'away', line: null }, parseGameScores('21-18'))).toBe('void')
    expect(settleBet({ market: 'match', outcomeKey: 'away', line: null }, [])).toBe('void')
  })
})

describe('betPayout', () => {
  it('pays stake times odds, refunds void and keeps open unknown', () => {
    expect(betPayout('won', 100, 2.7)).toBe(270)
    expect(betPayout('lost', 100, 2.7)).toBe(0)
    expect(betPayout('void', 100, 2.7)).toBe(100)
    expect(betPayout('open', 100, 2.7)).toBeNull()
  })
})

describe('closing line value', () => {
  const startsAt = '2026-10-22T10:50:00.000Z'
  const snapshots = [
    { outcomeKey: 'away', line: null, odds: 2.7, capturedAt: '2026-10-22T05:00:00.000Z' },
    { outcomeKey: 'home', line: null, odds: 1.25, capturedAt: '2026-10-22T05:00:00.000Z' },
    { outcomeKey: 'away', line: null, odds: 2.4, capturedAt: '2026-10-22T10:30:00.000Z' },
    { outcomeKey: 'home', line: null, odds: 1.5, capturedAt: '2026-10-22T10:30:00.000Z' },
    { outcomeKey: 'away', line: null, odds: 1.9, capturedAt: '2026-10-22T11:00:00.000Z' },
    { outcomeKey: 'home', line: null, odds: 1.8, capturedAt: '2026-10-22T11:00:00.000Z' },
  ]

  it('uses the last capture before the start and de-vigs the market', () => {
    const closing = closingOdds(snapshots, { outcomeKey: 'away', line: null }, startsAt)
    expect(closing?.odds).toBe(2.4)
    expect(closing?.market).toBeCloseTo((1 / 2.4) / (1 / 2.4 + 1 / 1.5), 10)
  })

  it('returns null when nothing was captured before the start or the line moved', () => {
    expect(closingOdds(snapshots, { outcomeKey: 'away', line: null }, '2026-10-22T04:00:00.000Z')).toBeNull()
    expect(closingOdds(snapshots, { outcomeKey: 'away', line: 1.5 }, startsAt)).toBeNull()
  })

  it('compares bet odds with closing odds', () => {
    expect(closingLineValue(2.7, 2.4)).toBeCloseTo(0.125, 10)
    expect(closingLineValue(2.7, null)).toBeNull()
  })
})

describe('summarizeBets', () => {
  const bet = (overrides: Partial<BetRecord>): BetRecord => ({
    id: 'bet',
    fixtureId: null,
    discipline: 'MS',
    awayName: 'A',
    homeName: 'B',
    startsAt: null,
    market: 'match',
    outcomeKey: 'away',
    outcomeLabel: 'A',
    line: null,
    odds: 2,
    stake: 100,
    placedAt: '2026-10-22T00:00:00.000Z',
    modelVersion: null,
    probability: null,
    ev: null,
    action: null,
    status: 'open',
    payout: null,
    closingOdds: null,
    closingMarket: null,
    clv: null,
    settledAt: null,
    note: '',
    ...overrides,
  })

  it('counts only decided bets for win rate and ROI', () => {
    const stats = summarizeBets([
      bet({ status: 'won', odds: 2.5, payout: 250, ev: 0.1, clv: 0.05 }),
      bet({ status: 'lost', payout: 0, ev: -0.02, clv: -0.01 }),
      bet({ status: 'void', payout: 100 }),
      bet({ status: 'open' }),
    ])
    expect(stats).toMatchObject({ count: 4, open: 1, won: 1, lost: 1, void: 1, winRate: 0.5, staked: 200, profit: 50, roi: 0.25 })
    expect(stats.averageEv).toBeCloseTo(0.04, 10)
    expect(stats.averageClv).toBeCloseTo(0.02, 10)
    expect(stats.positiveClvRate).toBe(0.5)
  })

  it('returns empty rates without decided bets', () => {
    expect(summarizeBets([])).toMatchObject({ count: 0, winRate: null, roi: null, averageClv: null })
  })
})
