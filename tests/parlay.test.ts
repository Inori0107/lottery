import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARLAY_CONFIG,
  evaluateParlay,
  isFragileLeg,
  parlayProbabilityFromQuote,
  type ParlayLeg,
} from '../shared/parlay'
import { openLedger } from '../server/db/ledger'
import { insertParlay } from '../server/models/parlayStore'

const leg = (overrides: Partial<ParlayLeg>): ParlayLeg => ({
  id: overrides.id ?? '1',
  fixtureId: 1,
  sport: 'badminton',
  discipline: 'MS',
  tournament: 'French Open',
  round: 'QF',
  awayName: 'A',
  homeName: 'B',
  market: 'match',
  outcomeKey: 'away',
  outcomeLabel: 'A',
  line: null,
  odds: 1.8,
  probability: 0.58,
  probabilitySource: 'model',
  dataSufficient: true,
  startsAt: '2026-10-22T10:00:00.000Z',
  ...overrides,
})

describe('過關警示', () => {
  it('延長局／deuce 敏感腳超過上限就警告，但不擋', () => {
    const legs = [
      leg({ id: 't', market: 'totals', line: 80.5, odds: 1.9, outcomeLabel: '大 80.5' }),
      leg({ id: 's', market: 'set1', fixtureId: 2, odds: 1.7, outcomeLabel: 'A 第一局' }),
    ]
    expect(isFragileLeg(legs[0]!)).toBe(true)
    const result = evaluateParlay(legs)
    expect(result.warnings.some(warning => warning.code === 'fragile')).toBe(true)
    expect(result.combinedOdds).toBeCloseTo(1.9 * 1.7)
  })

  it('同一賽事輪次超過兩腳、短賠、同場相關都列出', () => {
    const legs = [
      leg({ id: 'a', odds: 1.15, outcomeLabel: 'A' }),
      leg({ id: 'b', market: 'set1', odds: 1.9, outcomeLabel: '第一局 A' }),
      leg({ id: 'c', fixtureId: 2, odds: 1.8, outcomeLabel: 'C', tournament: 'French Open', round: 'QF' }),
    ]
    const result = evaluateParlay(legs)
    expect(result.warnings.map(warning => warning.code).sort()).toEqual([
      'correlated',
      'same-round',
      'short-odds',
    ])
  })

  it('五腳時列出三串組合的合賠、EV 與金額', () => {
    const legs = Array.from({ length: 5 }, (_, index) => leg({
      id: String(index),
      fixtureId: index + 1,
      tournament: `T${index}`,
      round: 'R16',
      odds: 1.5,
      probability: 0.7,
      outcomeLabel: `L${index}`,
    }))
    const result = evaluateParlay(legs)
    expect(result.splitHint).toContain('5 腳')
    expect(result.splits).toHaveLength(10)
    expect(result.splits[0]?.combinedOdds).toBeCloseTo(1.5 ** 3)
    expect(result.splits[0]?.ev).toBeCloseTo(0.7 ** 3 * 1.5 ** 3 - 1)
    expect(result.splits[0]?.stakeCost).toBe(1)
  })

  it('資料不足腳改用去水機率並標註無模型機率', () => {
    const picked = parlayProbabilityFromQuote(false, null, 0.52)
    expect(picked).toEqual({ probability: 0.52, probabilitySource: 'market', dataSufficient: false })
    const result = evaluateParlay([
      leg({ ...picked, outcomeLabel: '冷門' }),
    ])
    expect(result.warnings.some(warning => warning.code === 'insufficient' && warning.message.includes('去水'))).toBe(true)
  })

  it('門檻可設定', () => {
    const result = evaluateParlay(
      [leg({ odds: 1.25 })],
      { ...DEFAULT_PARLAY_CONFIG, shortOddsThreshold: 1.3 },
    )
    expect(result.warnings.some(warning => warning.code === 'short-odds')).toBe(true)
  })

  it('記錄過關時警示不擋儲存', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-parlay-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    const placed = insertParlay(ledger, {
      stake: 100,
      legs: [
        leg({ id: 'a', odds: 1.15, fixtureId: 1 }),
        leg({ id: 'b', market: 'totals', line: 80.5, odds: 1.9, fixtureId: 2, outcomeLabel: '大' }),
      ],
    })
    expect(placed?.status).toBe('open')
    expect(placed?.legs).toHaveLength(2)
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
