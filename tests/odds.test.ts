import { describe, expect, it } from 'vitest'
import {
  calibrateProbability,
  marketAction,
  MIN_CANDIDATE_EV,
  MIN_GAME1_CANDIDATE_EV,
  MIN_POINTS_CANDIDATE_EV,
  outcomeAction,
  POINTS_CAUTION,
  type MarketActionInput,
} from '../shared/decision'
import { buildMarketQuote } from '../server/models/quote'
import { devigMultiWay, devigTwoWay, expectedValue, impliedProbability } from '../server/models/odds'

const msMatchBins = [
  { lo: 0.4, hi: 0.5, n: 3227, predicted: 0.455, actual: 0.444 },
  { lo: 0.5, hi: 0.6, n: 3146, predicted: 0.544, actual: 0.630 },
]

const decide = (overrides: Partial<MarketActionInput>): ReturnType<typeof marketAction> =>
  marketAction({
    evAway: 0.08,
    evHome: -0.12,
    probabilityAway: 0.62,
    probabilityHome: 0.38,
    marketAway: 0.56,
    marketHome: 0.44,
    minEv: MIN_CANDIDATE_EV,
    sampleOk: true,
    dataLagOk: true,
    staleOk: true,
    ...overrides,
  })

describe('賠率', () => {
  it('計算隱含機率、去水與期望值', () => {
    expect(impliedProbability(1.8)).toBeCloseTo(1 / 1.8)
    expect(expectedValue(0.58, 1.8)).toBeCloseTo(0.044)
    const market = devigTwoWay(1.8, 2.1)
    const impliedA = 1 / 1.8
    const impliedB = 1 / 2.1
    expect(market.marketA).toBeCloseTo(impliedA / (impliedA + impliedB))
    expect(market.marketA + market.marketB).toBeCloseTo(1)
  })
})

describe('多選項決策', () => {
  it('多選項去水總和為 1', () => {
    const market = devigMultiWay([2.2, 3.3, 4.35, 3.2])
    expect(market.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(market[0]).toBeGreaterThan(market[2] ?? 1)
  })

  it('四選項挑期望值最高的那個，並帶分數模型註記', () => {
    const outcome = (key: string, ev: number, probability: number, market: number) => ({ key, ev, probability, market, name: key })
    const decision = outcomeAction({
      outcomes: [
        outcome('2:0', -0.05, 0.43, 0.42),
        outcome('2:1', 0.10, 0.33, 0.28),
        outcome('1:2', -0.10, 0.12, 0.21),
        outcome('0:2', -0.20, 0.12, 0.29),
      ],
      minEv: MIN_POINTS_CANDIDATE_EV,
      sampleOk: true,
      dataLagOk: true,
      staleOk: true,
      caution: POINTS_CAUTION,
    })
    expect(decision).toMatchObject({
      action: 'candidate',
      outcomeKey: '2:1',
      reason: `2:1：校準機率高於盈虧兩平，優勢足夠（${POINTS_CAUTION}）`,
    })
  })

  it('全部為負時不投', () => {
    const decision = outcomeAction({
      outcomes: ['a', 'b', 'c'].map(key => ({ key, ev: -0.1, probability: 0.3, market: 0.3 })),
      minEv: MIN_POINTS_CANDIDATE_EV,
      sampleOk: true,
      dataLagOk: true,
      staleOk: true,
    })
    expect(decision).toMatchObject({ action: 'pass', outcomeKey: null, reason: '所有選項校準期望值皆為負' })
  })
})

describe('校準機率', () => {
  it('在有樣本的箱子中心之間線性內插', () => {
    expect(calibrateProbability(0.531, msMatchBins)).toBeCloseTo(0.603, 3)
  })

  it('沒有實際勝率時退回原始機率', () => {
    expect(calibrateProbability(0.53, [
      { lo: 0.5, hi: 0.6, n: 0, predicted: null, actual: null },
    ])).toBe(0.53)
  })
})

describe('投注決策', () => {
  it('截圖那組賠率校準後為不投', () => {
    const quote = buildMarketQuote(0.531, {
      odds: { away: 1.3, home: 2.5 },
      calibration: msMatchBins,
      minEv: MIN_CANDIDATE_EV,
      sampleOk: true,
      dataLagOk: true,
      staleOk: true,
    })
    expect(quote.probabilityCalibratedAway).toBeCloseTo(0.603, 3)
    expect(quote.evAway ?? 0).toBeLessThan(0)
    expect(quote.evHome ?? 1).toBeLessThanOrEqual(0)
    expect(quote.decision).toMatchObject({ action: 'pass', reason: '兩側校準期望值皆為負' })
  })

  it('校準期望值足夠且品質通過是候選', () => {
    expect(decide({ awayName: 'A', homeName: 'B' })).toMatchObject({
      action: 'candidate',
      side: 'away',
      reason: 'A：校準機率高於盈虧兩平，優勢足夠',
    })
  })

  it('正期望值太薄、樣本不足、資料過舊或差距大是觀望', () => {
    expect(decide({ evAway: 0.028 }).reason).toBe('算式為正，但優勢太薄')
    expect(decide({ sampleOk: false }).reason).toBe('算式為正，但樣本不足')
    expect(decide({ dataLagOk: false }).reason).toBe('算式為正，但資料過舊')
    expect(decide({ probabilityAway: 0.72, marketAway: 0.58, evAway: 0.20 }).reason).toBe('算式為正，但與盤口差距大')
  })

  it('第一局門檻 8%，不足時註明測試誤差', () => {
    expect(decide({
      evAway: 0.06,
      minEv: MIN_GAME1_CANDIDATE_EV,
      isGame1: true,
    }).reason).toBe('算式為正，但第一局測試誤差較大')

    expect(decide({
      evAway: 0.09,
      minEv: MIN_GAME1_CANDIDATE_EV,
      isGame1: true,
      awayName: 'A',
    })).toMatchObject({
      action: 'candidate',
      reason: 'A：校準機率高於盈虧兩平，優勢足夠（第一局測試誤差較大）',
    })
  })

  it('沒有賠率時不估計期望值', () => {
    const quote = buildMarketQuote(0.6, {
      minEv: MIN_CANDIDATE_EV,
      sampleOk: true,
      dataLagOk: true,
      staleOk: true,
    })
    expect(quote.decision.reason).toBe('沒有賠率，無法估計期望值')
    expect(quote.probabilityCalibratedAway).toBe(0.6)
    expect(quote.evAway).toBeNull()
  })
})
