import { describe, expect, it } from 'vitest'
import {
  blendProbability,
  checkDivergence,
  mildCalibrate,
  DEFAULT_MODEL_CONFIG,
  formatConfigSummary,
  DIVERGENCE_FLAG,
} from '../shared/modelConfig'

describe('市場混合計算 blendProbability', () => {
  it('使用預設權重混合模型與市場機率', () => {
    const modelProb = 0.738
    const marketProb = 0.684
    const blended = blendProbability(modelProb, marketProb)
    expect(blended).toBeCloseTo(0.65 * 0.684 + 0.35 * 0.738, 3)
    expect(blended).toBeCloseTo(0.7029, 3)
  })

  it('當模型機率為 null 時回傳市場機率', () => {
    expect(blendProbability(null, 0.6)).toBe(0.6)
  })

  it('當市場機率為 null 時回傳模型機率', () => {
    expect(blendProbability(0.7, null)).toBe(0.7)
  })

  it('兩者皆為 null 時回傳 null', () => {
    expect(blendProbability(null, null)).toBeNull()
  })

  it('可自訂權重', () => {
    const blended = blendProbability(0.8, 0.6, {
      marketWeight: 0.7,
      modelWeight: 0.3,
      enabled: true,
    })
    expect(blended).toBeCloseTo(0.7 * 0.6 + 0.3 * 0.8, 4)
  })

  it('停用混合時回傳模型機率', () => {
    const blended = blendProbability(0.8, 0.6, {
      marketWeight: 0.65,
      modelWeight: 0.35,
      enabled: false,
    })
    expect(blended).toBe(0.8)
  })
})

describe('發散檢測 checkDivergence', () => {
  it('差距小於門檻時不發散', () => {
    const result = checkDivergence(0.70, 0.68)
    expect(result.diverges).toBe(false)
    expect(result.diffPp).toBeCloseTo(2, 1)
  })

  it('差距大於門檻時發散', () => {
    const result = checkDivergence(0.842, 0.684)
    expect(result.diverges).toBe(true)
    expect(result.diffPp).toBeCloseTo(15.8, 1)
  })

  it('使用預設 9pp 門檻', () => {
    expect(checkDivergence(0.75, 0.66).diverges).toBe(false)
    expect(checkDivergence(0.75, 0.65).diverges).toBe(true)
  })

  it('模型或市場為 null 時不發散', () => {
    expect(checkDivergence(null, 0.7).diverges).toBe(false)
    expect(checkDivergence(0.7, null).diverges).toBe(false)
    expect(checkDivergence(null, null).diverges).toBe(false)
  })

  it('停用時不發散', () => {
    const result = checkDivergence(0.9, 0.5, { thresholdPp: 9, enabled: false })
    expect(result.diverges).toBe(false)
  })
})

describe('溫和校準 mildCalibrate', () => {
  it('向 0.5 收縮高機率', () => {
    const calibrated = mildCalibrate(0.842, 0.3)
    expect(calibrated).toBeCloseTo(0.842 + 0.3 * (0.5 - 0.842), 4)
    expect(calibrated).toBeLessThan(0.842)
  })

  it('向 0.5 收縮低機率', () => {
    const calibrated = mildCalibrate(0.3, 0.3)
    expect(calibrated).toBeGreaterThan(0.3)
  })

  it('0.5 機率不變', () => {
    expect(mildCalibrate(0.5, 0.3)).toBeCloseTo(0.5, 4)
  })
})

describe('配置摘要格式化', () => {
  it('產生包含所有設定的摘要', () => {
    const summary = formatConfigSummary()
    expect(summary).toContain('模型配置')
    expect(summary).toContain('混合權重')
    expect(summary).toContain('65%')
    expect(summary).toContain('35%')
    expect(summary).toContain('發散警示')
    expect(summary).toContain('9pp')
    expect(summary).toContain('校準模式')
    expect(summary).toContain('投注紀律')
  })
})

describe('2500 Gunawan 範例計算', () => {
  it('計算混合機率與 EV', () => {
    const modelRaw = 0.738
    const marketVigRemoved = 0.684
    
    const blended = blendProbability(modelRaw, marketVigRemoved)
    expect(blended).toBeCloseTo(0.7028, 3)
    
    const divergence = checkDivergence(modelRaw, marketVigRemoved)
    expect(divergence.diverges).toBe(false)
    expect(divergence.diffPp).toBeCloseTo(5.4, 1)
    
    expect(blended).toBeLessThan(modelRaw)
    expect(blended).toBeGreaterThan(marketVigRemoved)
  })

  it('高機率區域發散檢測', () => {
    const calibrated = 0.842
    const marketVigRemoved = 0.684
    
    const divergence = checkDivergence(calibrated, marketVigRemoved)
    expect(divergence.diverges).toBe(true)
    expect(divergence.diffPp).toBeCloseTo(15.8, 1)
  })
})

describe('預設配置值', () => {
  it('混合權重總和為 1', () => {
    const { blending } = DEFAULT_MODEL_CONFIG
    expect(blending.marketWeight + blending.modelWeight).toBeCloseTo(1, 4)
  })

  it('發散門檻為 9pp', () => {
    expect(DEFAULT_MODEL_CONFIG.divergence.thresholdPp).toBe(9)
  })

  it('校準模式為 mild', () => {
    expect(DEFAULT_MODEL_CONFIG.calibration.mode).toBe('mild')
  })

  it('投注紀律範圍合理', () => {
    const { discipline } = DEFAULT_MODEL_CONFIG
    expect(discipline.minOdds).toBeGreaterThanOrEqual(1.1)
    expect(discipline.maxOdds).toBeLessThanOrEqual(3)
    expect(discipline.optimalParlayLegsMin).toBeGreaterThanOrEqual(2)
    expect(discipline.optimalParlayLegsMax).toBeLessThanOrEqual(5)
  })
})
