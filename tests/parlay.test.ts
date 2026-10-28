import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import { getBankroll, insertBet, insertTicket, listBetsForSport, listTickets } from '../server/models/ledgerStore'
import {
  canAfford,
  combinedOdds,
  fractionalKelly,
  isParlayQuote,
  quoteParlay,
  resolveParlayTicket,
  suggestedStake,
  validateParlayLegs,
} from '../shared/parlay'
import type { SlipLeg } from '../shared/types'

const leg = (overrides: Partial<SlipLeg>): SlipLeg => ({
  fixtureId: 1,
  sport: 'badminton',
  discipline: 'MS',
  awayName: 'A',
  homeName: 'B',
  startsAt: '2026-10-26T02:00:00.000Z',
  market: 'match',
  outcomeKey: 'away',
  outcomeLabel: 'A',
  line: null,
  odds: 1.8,
  probability: 0.6,
  ev: 0.08,
  action: 'watch',
  modelVersion: 'v1',
  ...overrides,
})

describe('過關規則', () => {
  it('同場拒絕、跨羽球排球網球允許', () => {
    expect(validateParlayLegs([
      leg({ fixtureId: 1 }),
      leg({ fixtureId: 1, market: 'set1' }),
    ])?.reason).toBe('同場不可串關')
    expect(validateParlayLegs([
      leg({ fixtureId: 1, sport: 'badminton', discipline: 'MS' }),
      leg({ fixtureId: 2, sport: 'volleyball', discipline: 'M', awayName: 'C', homeName: 'D' }),
      leg({ fixtureId: 3, sport: 'tennis', discipline: 'ATP', awayName: 'E', homeName: 'F' }),
    ])).toBeNull()
  })

  it('綜合賠率相乘並四捨五入到兩位，Kelly 為 EV/(odds-1) 再乘 0.25', () => {
    const quoted = quoteParlay([leg({ odds: 1.8 }), leg({ fixtureId: 2, odds: 2.1 })])
    expect('combinedOdds' in quoted).toBe(true)
    if (!('combinedOdds' in quoted)) return
    expect(quoted.combinedOdds).toBe(combinedOdds([{ odds: 1.8 }, { odds: 2.1 }]))
    expect(quoted.combinedOdds).toBe(3.78)
    expect(quoted.combinedProbability).toBeCloseTo(0.36, 10)
    expect(fractionalKelly(0.1, 2)).toBeCloseTo(0.025, 10)
  })

  it('模擬餘額不足不可下單，全贏／一腿輸／一腿作廢降關', () => {
    expect(canAfford('sim', 50, 100)).toBe(false)
    expect(canAfford('sim', 100, 100)).toBe(true)
    expect(canAfford('real', 0, 100)).toBe(true)
    const allWon = resolveParlayTicket([
      { status: 'won', odds: 1.8 },
      { status: 'won', odds: 2 },
    ], 100)
    expect(allWon.status).toBe('won')
    expect(allWon.payout).toBe(360)
    const oneLost = resolveParlayTicket([
      { status: 'won', odds: 1.8 },
      { status: 'lost', odds: 2 },
    ], 100)
    expect(oneLost.status).toBe('lost')
    expect(oneLost.payout).toBe(0)
    const reduced = resolveParlayTicket([
      { status: 'won', odds: 1.8 },
      { status: 'void', odds: 2 },
    ], 100)
    expect(reduced.status).toBe('won')
    expect(reduced.combinedOdds).toBe(1.8)
    expect(reduced.payout).toBe(180)
    const voided = resolveParlayTicket([
      { status: 'void', odds: 1.8 },
      { status: 'void', odds: 2 },
    ], 100)
    expect(voided.status).toBe('void')
    expect(voided.payout).toBe(100)
  })

  it('模擬本金不足時 insertTicket 會拒絕', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-parlay-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    expect(getBankroll(ledger, 'sim').balance).toBe(10_000)
    expect(() => insertTicket(ledger, {
      ledgerKind: 'sim',
      stake: 20_000,
      legs: [leg({ fixtureId: 1 }), leg({ fixtureId: 2 })],
    })).toThrow('模擬本金不足')
    const ticket = insertTicket(ledger, {
      ledgerKind: 'sim',
      stake: 100,
      legs: [
        leg({ fixtureId: 1, sport: 'badminton' }),
        leg({ fixtureId: 2, sport: 'tennis', discipline: 'ATP' }),
      ],
    })
    expect(ticket.kind).toBe('parlay')
    expect(ticket.legs).toHaveLength(2)
    expect(getBankroll(ledger, 'sim').balance).toBe(9900)
    expect(listTickets(ledger, 'tennis')).toHaveLength(1)
    expect(listBetsForSport(ledger, 'badminton')).toHaveLength(0)
    insertBet(ledger, {
      ...leg({ fixtureId: 9, sport: 'badminton' }),
      stake: 50,
    })
    expect(listBetsForSport(ledger, 'badminton')).toHaveLength(1)
    expect(isParlayQuote(quoteParlay(ticket.legs))).toBe(true)
    expect(suggestedStake(9900, {
      combinedOdds: 3.6,
      combinedProbability: 0.3,
      ev: 0.08,
      kelly: 0.02,
      reason: null,
    }, 'kelly')).toBe(198)
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
