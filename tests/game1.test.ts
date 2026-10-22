import { describe, expect, it } from 'vitest'
import {
  buildBins,
  clampGame1ToMatch,
  fitLogistic,
  matchProbabilityToGame1,
  predictBin,
  predictLogistic,
  selectGame1Method,
  shrunkWinRate,
} from '../server/models/game1'
import { buildQuoteWarnings, quotePlayersWithForm } from '../server/models/quote'

const binsModel = {
  method: 'bins' as const,
  coefficients: [0, 0, 0] as [number, number, number],
  bins: buildBins([]),
  shrinkMode: 'raw' as const,
}

describe('第一局模型', () => {
  it('驗證較差時改用分箱，不直接沿用全場機率', () => {
    expect(selectGame1Method(0.7, 0.65, 0.6, 0.68)).toBe('bins')
    expect(selectGame1Method(0.5, 0.55, 0.6, 0.52)).toBe('logistic')
    expect(selectGame1Method(0.55, 0.5, 0.6, 0.52)).toBe('bins')
    expect(selectGame1Method(0.5, 0.55, 0.6, 0.48)).toBe('bo3')
  })

  it('收縮勝率在沒有樣本時是 0.5', () => {
    expect(shrunkWinRate([])).toBe(0.5)
    expect(shrunkWinRate([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(12 / 14)
  })

  it('邏輯斯迴歸會跟著 Elo 差的方向移動', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      eloDiff: index < 20 ? 120 : -120,
      formDiff: 0,
      y: index < 20 ? 1 : 0,
      pMatch: index < 20 ? 0.7 : 0.3,
    }))
    const coefficients = fitLogistic(rows)
    expect(predictLogistic(coefficients, 120, 0)).toBeGreaterThan(0.5)
    expect(predictLogistic(coefficients, -120, 0)).toBeLessThan(0.5)
  })

  it('全場 0.894 反推第一局約 0.80，且熱門第一局低於全場', () => {
    const game1 = matchProbabilityToGame1(0.894)
    expect(game1).toBeCloseTo(0.80, 2)
    expect(game1).toBeLessThan(0.894)
    expect(matchProbabilityToGame1(0.5)).toBeCloseTo(0.5, 5)
  })

  it('熱門第一局若反超全場，改回三局兩勝反推', () => {
    const clamped = clampGame1ToMatch(0.90, 0.894)
    expect(clamped).toBeCloseTo(matchProbabilityToGame1(0.894), 5)
    expect(clamped).toBeLessThan(0.894)
    expect(clampGame1ToMatch(0.70, 0.894)).toBeCloseTo(0.70)
  })

  it('分箱機率與全場 Elo 機率分開', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1700, matchCount: 30, set1Count: 30, lastPlayedOn: '2024-01-01', game1Recent: [1, 1, 1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 30, set1Count: 30, lastPlayedOn: '2024-01-01', game1Recent: [0, 0, 0] },
      binsModel,
      {},
      '2024-01-01',
    )
    const bins = buildBins([{ eloDiff: 200, formDiff: 0, y: 0, pMatch: 0.75 }])
    const game1 = predictBin(bins, 200)
    expect(quoted.matchWinner.probabilityAway).not.toBeNull()
    expect(game1).not.toBeCloseTo(quoted.matchWinner.probabilityAway ?? 0)
    expect(quoted.set1Winner.status).toBe('ok')
    expect(quoted.set1Winner.probabilityAway).not.toBeCloseTo(quoted.matchWinner.probabilityAway ?? 0)
  })

  it('資料落後不會把截止日前剛出賽的選手大幅收縮', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1863, matchCount: 58, set1Count: 58, lastPlayedOn: '2026-06-16', game1Recent: [0] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 69, set1Count: 69, lastPlayedOn: '2026-06-19', game1Recent: [1] },
      { ...binsModel, method: 'bo3' },
      {},
      '2026-07-05',
    )
    expect(quoted.matchWinner.probabilityAway ?? 0).toBeGreaterThan(0.85)
    expect(quoted.set1Winner.probabilityAway ?? 1).toBeLessThan(quoted.matchWinner.probabilityAway ?? 0)
  })

  it('只對資料截止前就已停賽的選手把分數拉回 1500', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1800, matchCount: 100, set1Count: 100, lastPlayedOn: '2025-11-21', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1800, matchCount: 100, set1Count: 100, lastPlayedOn: '2026-07-03', game1Recent: [1] },
      { ...binsModel, method: 'bo3' },
      {},
      '2026-07-05',
    )
    expect(quoted.matchWinner.probabilityAway).toBeLessThan(0.5)
  })

  it('報價使用有效 Elo，少樣本較接近 50%', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1800, matchCount: 10, set1Count: 10, lastPlayedOn: '2024-07-01', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1800, matchCount: 100, set1Count: 100, lastPlayedOn: '2024-07-01', game1Recent: [1] },
      { ...binsModel, method: 'bo3', shrinkMode: 'full' as const },
      {},
      '2024-07-01',
    )
    expect(quoted.matchWinner.probabilityAway).toBeLessThan(0.5)
    expect(quoted.set1Winner.probabilityAway).not.toBeNull()
    expect(quoted.set1Winner.probabilityAway ?? 0).toBeGreaterThan(quoted.matchWinner.probabilityAway ?? 1)
    expect(quoted.set1Winner.probabilityAway ?? 1).toBeLessThan(0.5)
  })

  it('選手過期用資料截止日，剛在截止日前出賽的不標不確定', () => {
    const warnings = buildQuoteWarnings(
      { id: 'a', name: 'A', elo: 1600, matchCount: 61, set1Count: 61, lastPlayedOn: '2025-11-21' },
      { id: 'b', name: 'B', elo: 1600, matchCount: 159, set1Count: 159, lastPlayedOn: '2026-07-03' },
      '2026-10-22',
      '2026-07-05',
      false,
    )
    expect(warnings.some(warning => warning.includes('距報價日已'))).toBe(true)
    expect(warnings.some(warning => warning.includes('客隊最後出賽') && warning.includes('資料截止時'))).toBe(true)
    expect(warnings.some(warning => warning.includes('主隊最後出賽'))).toBe(false)
  })

  it('樣本少於 8 場時不評估', () => {
    const quoted = quotePlayersWithForm(
      { id: 'a', name: 'A', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01', game1Recent: [1] },
      { id: 'b', name: 'B', elo: 1500, matchCount: 1, set1Count: 1, lastPlayedOn: '2024-01-01', game1Recent: [0] },
      binsModel,
      { match: { away: 1.8, home: 2 } },
      '2024-01-01',
    )
    expect(quoted.matchWinner.status).toBe('insufficient')
    expect(quoted.set1Winner.status).toBe('insufficient')
    expect(quoted.matchWinner.probabilityAway).toBeNull()
  })
})
