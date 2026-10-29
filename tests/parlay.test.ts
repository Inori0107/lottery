import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import { deleteTicket, getBankroll, insertTicket, listTickets } from '../server/models/ledgerStore'
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
    expect(validateParlayLegs([leg({ fixtureId: 1 })])).toBeNull()
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
    const capturedAt = new Date().toISOString()
    const startsAt = new Date(Date.now() + 86_400_000).toISOString()
    for (const [id, sport, discipline] of [[1, 'badminton', 'MS'], [2, 'tennis', 'ATP']] as const) {
      ledger.prepare(`INSERT INTO fixtures (sportradar_id, tsl_event_id, sport, discipline, tournament, starts_at, play_date, away_name, home_name, updated_at) VALUES (?, 'test', ?, ?, 'Test', ?, '2099-01-01', 'A', 'B', ?)`).run(id, sport, discipline, startsAt, capturedAt)
      ledger.prepare(`INSERT INTO market_snapshots VALUES (?, ?, ?)`).run(id, capturedAt, JSON.stringify([{id:'market',market:'match',line:null,status:'available',selections:[{key:'away',odds:1.8},{key:'home',odds:2}]}]))
    }
    const ticket = insertTicket(ledger, {
      ledgerKind: 'sim',
      stake: 100,
      legs: [
        leg({ fixtureId: 1, sport: 'badminton', sourceMarketId: 'market', oddsCapturedAt: capturedAt }),
        leg({ fixtureId: 2, sport: 'tennis', discipline: 'ATP', sourceMarketId: 'market', oddsCapturedAt: capturedAt }),
      ],
    })
    expect(ticket.kind).toBe('parlay')
    expect(ticket.legs).toHaveLength(2)
    expect(getBankroll(ledger, 'sim').balance).toBe(9900)
    expect(listTickets(ledger, 'tennis')).toHaveLength(1)
    expect(listTickets(ledger, 'badminton')).toHaveLength(1)
    expect(insertTicket(ledger, { ledgerKind: 'real', stake: 100, legs: [leg({ fixtureId: 1 })] }).kind).toBe('single')
    expect(isParlayQuote(quoteParlay(ticket.legs))).toBe(true)
    expect(suggestedStake(9900, {
      combinedOdds: 3.6,
      combinedProbability: 0.3,
      ev: 0.08,
      kelly: 0.02,
      reason: null,
    }, 'kelly')).toBe(99)
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('封存不退款、不刪預測或結算歷史，且帳本分開', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-parlay-delete-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    const capturedAt = new Date().toISOString()
    const startsAt = new Date(Date.now() + 86_400_000).toISOString()
    for (const [id, sport, discipline] of [[1, 'badminton', 'MS'], [2, 'tennis', 'ATP']] as const) {
      ledger.prepare(`INSERT INTO fixtures (sportradar_id, tsl_event_id, sport, discipline, tournament, starts_at, play_date, away_name, home_name, updated_at) VALUES (?, 'test', ?, ?, 'Test', ?, '2099-01-01', 'A', 'B', ?)`).run(id, sport, discipline, startsAt, capturedAt)
      ledger.prepare(`INSERT INTO market_snapshots VALUES (?, ?, ?)`).run(id, capturedAt, JSON.stringify([{id:'market',market:'match',line:null,status:'available',selections:[{key:'away',odds:1.8},{key:'home',odds:2}]}]))
    }
    const simLegs = [
      leg({ fixtureId: 1, sourceMarketId: 'market', oddsCapturedAt: capturedAt }),
      leg({ fixtureId: 2, sport: 'tennis', discipline: 'ATP', sourceMarketId: 'market', oddsCapturedAt: capturedAt }),
    ]
    const sim = insertTicket(ledger, { ledgerKind: 'sim', stake: 250, legs: simLegs })
    expect(getBankroll(ledger, 'sim').balance).toBe(9750)
    expect(deleteTicket(ledger, sim.id)).toBe(true)
    expect(listTickets(ledger)).toHaveLength(0)
    expect(getBankroll(ledger, 'sim').balance).toBe(9750)
    expect(listTickets(ledger, null, 'sim', true)).toHaveLength(1)

    const settled = insertTicket(ledger, { ledgerKind: 'sim', stake: 250, legs: simLegs })
    ledger.prepare("UPDATE tickets SET status = 'won', payout = 450 WHERE id = ?").run(settled.id)
    ledger.prepare("UPDATE bankrolls SET balance = balance + 450 WHERE kind = 'sim'").run()
    expect(getBankroll(ledger, 'sim').balance).toBe(9950)
    expect(deleteTicket(ledger, settled.id)).toBe(true)
    expect(getBankroll(ledger, 'sim').balance).toBe(9950)
    expect(listTickets(ledger, null, 'sim', true)).toHaveLength(2)

    const real = insertTicket(ledger, { ledgerKind: 'real', stake: 1000, legs: [leg({ fixtureId: 9 }), leg({ fixtureId: 10 })] })
    ledger.prepare("UPDATE tickets SET status = 'won', payout = 1800 WHERE id = ?").run(real.id)
    expect(deleteTicket(ledger, real.id)).toBe(true)
    expect(deleteTicket(ledger, real.id)).toBe(false)
    expect(listTickets(ledger)).toHaveLength(0)
    expect(getBankroll(ledger, 'sim').balance).toBe(9950)
    expect(listTickets(ledger, null, 'sim', true)).toHaveLength(2)
    expect(listTickets(ledger, null, 'real', true)).toHaveLength(1)
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
