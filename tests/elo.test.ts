import { describe, expect, it } from 'vitest'
import { daysBetween, effectiveRating, expectedScore, updateElo } from '../server/models/elo'
import { selectShrinkMode } from '../server/models/backtest'
import { parseCsvRow } from '../server/models/dataset'

describe('Elo', () => {
  it('1500 對 1500，A 勝後變成 1516 與 1484', () => {
    const next = updateElo(1500, 1500, true)
    expect(next.expectedA).toBe(0.5)
    expect(next.ratingA).toBe(1516)
    expect(next.ratingB).toBe(1484)
  })

  it('使用賽前分數，平手起點的期望值是 0.5', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5)
  })

  it('同等分數、樣本較少的選手有效分數較接近 1500', () => {
    const few = effectiveRating(1800, 10, '2024-07-01', '2024-07-01')
    const many = effectiveRating(1800, 100, '2024-07-01', '2024-07-01')
    expect(few).toBeGreaterThan(1500)
    expect(few).toBeLessThan(many)
    expect(expectedScore(few, many)).toBeLessThan(0.5)
  })

  it('停賽把分數拉回 1500', () => {
    const active = effectiveRating(1800, 100, '2024-07-01', '2024-07-01', 'inactivity')
    const idle = effectiveRating(1800, 100, '2024-01-01', '2024-07-01', 'inactivity')
    expect(idle).toBeGreaterThan(1500)
    expect(idle).toBeLessThan(active)
    expect(daysBetween('2024-01-01', '2024-07-01')).toBe(182)
  })

  it('驗證段選 log loss 最低的收縮方式', () => {
    expect(selectShrinkMode(0.57, 0.56, 0.61)).toBe('inactivity')
    expect(selectShrinkMode(0.55, 0.56, 0.57)).toBe('raw')
    expect(selectShrinkMode(0.58, 0.57, 0.56)).toBe('full')
  })
})

describe('選手方向', () => {
  it('以較小的選手 ID 為 side A，並在 2:0 時不保留第三局需求', () => {
    const parsed = parseCsvRow({
      date: '2019-05-01',
      discipline: 'MS',
      tournament: 'Test Open',
      tier: 'Super 750',
      round: 'F',
      host_location: 'Taiwan',
      team1: 'ZED Player',
      team2: 'ANN Player',
      winner: '1',
      score: '21-18 21-16',
    })
    if (!('match' in parsed)) throw new Error('應該接受這場比賽')
    expect(parsed.match.sideAName).toBe('ANN Player')
    expect(parsed.match.sideAWonMatch).toBe(false)
    expect(parsed.match.games).toHaveLength(2)
    expect(parsed.match.games[0]?.pointsA).toBe(18)
    expect(parsed.match.matchLegal).toBe(true)
  })
})
