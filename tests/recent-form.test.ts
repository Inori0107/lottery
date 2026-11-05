import { describe, expect, it } from 'vitest'
import {
  timeDecayWeight,
  recencyWeightedWinRate,
  calculateFormScore,
  checkFatigue,
  countRecentUpsets,
  calculateRecentFormFeatures,
  formatRecentFormSummary,
} from '../server/models/recentForm'

describe('時間衰減權重 timeDecayWeight', () => {
  it('0 天權重為 1', () => {
    expect(timeDecayWeight(0)).toBe(1)
  })

  it('半衰期後權重為 0.5', () => {
    expect(timeDecayWeight(30, 30)).toBeCloseTo(0.5, 4)
  })

  it('兩個半衰期後權重為 0.25', () => {
    expect(timeDecayWeight(60, 30)).toBeCloseTo(0.25, 4)
  })
})

describe('時間加權勝率 recencyWeightedWinRate', () => {
  it('空結果回傳 0.5', () => {
    expect(recencyWeightedWinRate([], undefined, '2026-01-01')).toBe(0.5)
  })

  it('全勝回傳接近 1', () => {
    expect(recencyWeightedWinRate([1, 1, 1, 1, 1], undefined, '2026-01-01')).toBeCloseTo(1, 4)
  })

  it('全敗回傳接近 0', () => {
    expect(recencyWeightedWinRate([0, 0, 0, 0, 0], undefined, '2026-01-01')).toBeCloseTo(0, 4)
  })

  it('只計算最近 N 場', () => {
    const winRate = recencyWeightedWinRate(
      [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      undefined,
      '2026-01-01',
      { recentMatchCount: 5, timeDecayHalfLifeDays: 30, fatigueWindowDays: 7, fatigueThreshold: 4, recentMatchHigherK: 40, upsetEloDiff: 150 },
    )
    expect(winRate).toBeCloseTo(1, 4)
  })
})

describe('狀態分數 calculateFormScore', () => {
  it('空結果回傳 0', () => {
    expect(calculateFormScore([], 1500, [])).toBe(0)
  })

  it('對戰弱手全勝分數為正（超出預期）', () => {
    const score = calculateFormScore([1, 1, 1], 1700, [1400, 1400, 1400])
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.5)
  })

  it('對戰強手全勝分數為正', () => {
    const score = calculateFormScore([1, 1, 1], 1400, [1700, 1700, 1700])
    expect(score).toBeGreaterThan(0)
  })

  it('對戰弱手全敗分數為負', () => {
    const score = calculateFormScore([0, 0, 0], 1700, [1400, 1400, 1400])
    expect(score).toBeLessThan(0)
  })
})

describe('疲勞檢測 checkFatigue', () => {
  it('無日期不疲勞', () => {
    expect(checkFatigue(undefined, '2026-01-10')).toBe(false)
  })

  it('近期比賽少不疲勞', () => {
    expect(checkFatigue(['2026-01-01', '2026-01-02'], '2026-01-10')).toBe(false)
  })

  it('近期比賽多則疲勞', () => {
    const dates = ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07']
    expect(checkFatigue(dates, '2026-01-10')).toBe(true)
  })
})

describe('爆冷計算 countRecentUpsets', () => {
  it('無對手資料回傳 0', () => {
    const { upsets, upsetLosses } = countRecentUpsets([1, 0], 1500, undefined)
    expect(upsets).toBe(0)
    expect(upsetLosses).toBe(0)
  })

  it('以弱勝強計為爆冷', () => {
    const { upsets } = countRecentUpsets([1], 1400, [1700])
    expect(upsets).toBe(1)
  })

  it('以強敗弱計為被爆冷', () => {
    const { upsetLosses } = countRecentUpsets([0], 1700, [1400])
    expect(upsetLosses).toBe(1)
  })

  it('正常勝負不計', () => {
    const { upsets, upsetLosses } = countRecentUpsets([1, 0], 1500, [1400, 1600])
    expect(upsets).toBe(0)
    expect(upsetLosses).toBe(0)
  })
})

describe('完整特徵計算 calculateRecentFormFeatures', () => {
  it('資料不足標記', () => {
    const features = calculateRecentFormFeatures({
      recentResults: [1, 0],
      elo: 1500,
    }, '2026-01-01')
    expect(features.dataSufficient).toBe(false)
    expect(features.recentMatchCount).toBe(2)
  })

  it('資料充足時計算完整', () => {
    const features = calculateRecentFormFeatures({
      recentResults: [1, 1, 0, 1, 0],
      matchDates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
      elo: 1600,
      opponentElos: [1500, 1500, 1500, 1500, 1500],
    }, '2026-01-10')
    expect(features.dataSufficient).toBe(true)
    expect(features.recentMatchCount).toBe(5)
    expect(features.recencyWeightedWinRate).toBeGreaterThan(0)
    expect(features.recencyWeightedWinRate).toBeLessThan(1)
  })
})

describe('摘要格式化 formatRecentFormSummary', () => {
  it('包含基本資訊', () => {
    const summary = formatRecentFormSummary({
      recencyWeightedWinRate: 0.6,
      formScore: 0.1,
      fatigueWarning: false,
      recentMatchCount: 5,
      recentUpsets: 0,
      recentUpsetLosses: 0,
      dataSufficient: true,
    })
    expect(summary).toContain('近期狀態')
    expect(summary).toContain('5 場')
    expect(summary).toContain('60.0%')
  })

  it('顯示疲勞警示', () => {
    const summary = formatRecentFormSummary({
      recencyWeightedWinRate: 0.5,
      formScore: 0,
      fatigueWarning: true,
      recentMatchCount: 5,
      recentUpsets: 0,
      recentUpsetLosses: 0,
      dataSufficient: true,
    })
    expect(summary).toContain('疲勞警示')
  })

  it('顯示爆冷次數', () => {
    const summary = formatRecentFormSummary({
      recencyWeightedWinRate: 0.6,
      formScore: 0.2,
      fatigueWarning: false,
      recentMatchCount: 5,
      recentUpsets: 2,
      recentUpsetLosses: 1,
      dataSufficient: true,
    })
    expect(summary).toContain('爆冷')
    expect(summary).toContain('2 次')
  })
})
