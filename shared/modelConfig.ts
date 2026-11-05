/**
 * 模型配置：所有可調整的閾值與參數集中於此
 * Model Configuration: All configurable thresholds and parameters in one place
 */

/** 市場混合設定 Market Blending Settings */
export type MarketBlendingConfig = {
  /** 市場權重 (0.6-0.7 recommended, default 0.65) */
  marketWeight: number
  /** 模型權重 (1 - marketWeight) */
  modelWeight: number
  /** 是否啟用混合 */
  enabled: boolean
}

/** 發散警示設定 Divergence Guard Settings */
export type DivergenceGuardConfig = {
  /** 發散閾值（百分點），超過此值標記「待質化確認」 */
  thresholdPp: number
  /** 是否啟用發散警示 */
  enabled: boolean
}

/** 校準模式 Calibration Mode */
export type CalibrationMode = 'none' | 'mild' | 'full'

/** 校準設定 Calibration Settings */
export type CalibrationConfig = {
  /** 校準模式：none=使用原始模型, mild=向0.5收縮, full=完整校準 */
  mode: CalibrationMode
  /** mild 模式的收縮係數 (0.0-1.0, 0.3 means 30% shrink toward 0.5) */
  mildShrinkFactor: number
}

/** 近期狀態設定 Recent Form Settings */
export type RecentFormConfig = {
  /** 計算近期狀態的比賽數量 */
  recentMatchCount: number
  /** 時間衰減半衰期（天） */
  timeDecayHalfLifeDays: number
  /** 疲勞計算的時間窗口（天） */
  fatigueWindowDays: number
  /** 疲勞警示的比賽數量門檻 */
  fatigueThreshold: number
  /** 近期比賽使用較高 K 值 */
  recentMatchHigherK: number
  /** 爆冷定義的 Elo 差距 */
  upsetEloDiff: number
}

/** 投注紀律設定 Betting Discipline Settings */
export type BettingDisciplineConfig = {
  /** 候選賠率下限 */
  minOdds: number
  /** 候選賠率上限 */
  maxOdds: number
  /** 最佳串關腳數下限 */
  optimalParlayLegsMin: number
  /** 最佳串關腳數上限 */
  optimalParlayLegsMax: number
  /** 單筆投注佔資金比例上限 */
  maxStakeFraction: number
  /** 是否需要市場、模型、質化同向才能候選 */
  requireAllDirectionsAlign: boolean
}

/** 完整模型配置 Full Model Configuration */
export type ModelConfig = {
  blending: MarketBlendingConfig
  divergence: DivergenceGuardConfig
  calibration: CalibrationConfig
  recentForm: RecentFormConfig
  discipline: BettingDisciplineConfig
}

/** 預設配置 Default Configuration */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  blending: {
    marketWeight: 0.65,
    modelWeight: 0.35,
    enabled: true,
  },
  divergence: {
    thresholdPp: 9,
    enabled: true,
  },
  calibration: {
    mode: 'mild',
    mildShrinkFactor: 0.3,
  },
  recentForm: {
    recentMatchCount: 5,
    timeDecayHalfLifeDays: 30,
    fatigueWindowDays: 7,
    fatigueThreshold: 4,
    recentMatchHigherK: 40,
    upsetEloDiff: 150,
  },
  discipline: {
    minOdds: 1.5,
    maxOdds: 2.2,
    optimalParlayLegsMin: 2,
    optimalParlayLegsMax: 3,
    maxStakeFraction: 0.02,
    requireAllDirectionsAlign: true,
  },
}

/** 取得當前配置（未來可支援從環境變數或資料庫讀取）*/
export const getModelConfig = (): ModelConfig => {
  return { ...DEFAULT_MODEL_CONFIG }
}

/** 混合機率計算 Blend probability calculation */
export const blendProbability = (
  modelProbability: number | null,
  marketProbability: number | null,
  config: MarketBlendingConfig = DEFAULT_MODEL_CONFIG.blending,
): number | null => {
  if (!config.enabled) return modelProbability
  if (modelProbability === null) return marketProbability
  if (marketProbability === null) return modelProbability
  return config.marketWeight * marketProbability + config.modelWeight * modelProbability
}

/** 發散檢測 Divergence detection */
export const checkDivergence = (
  modelProbability: number | null,
  marketProbability: number | null,
  config: DivergenceGuardConfig = DEFAULT_MODEL_CONFIG.divergence,
): { diverges: boolean; diffPp: number | null } => {
  if (!config.enabled) return { diverges: false, diffPp: null }
  if (modelProbability === null || marketProbability === null) {
    return { diverges: false, diffPp: null }
  }
  const diffPp = Math.abs(modelProbability - marketProbability) * 100
  return { diverges: diffPp > config.thresholdPp, diffPp }
}

/** 溫和校準：向 0.5 收縮 Mild calibration: shrink toward 0.5 */
export const mildCalibrate = (
  probability: number,
  shrinkFactor: number = DEFAULT_MODEL_CONFIG.calibration.mildShrinkFactor,
): number => {
  return probability + shrinkFactor * (0.5 - probability)
}

/** 格式化配置摘要用於分析包 Format config summary for analysis pack */
export const formatConfigSummary = (config: ModelConfig = DEFAULT_MODEL_CONFIG): string => {
  const lines = [
    '## 模型配置',
    `混合權重：市場 ${(config.blending.marketWeight * 100).toFixed(0)}% / 模型 ${(config.blending.modelWeight * 100).toFixed(0)}%${config.blending.enabled ? '' : '（停用）'}`,
    `發散警示：${config.divergence.enabled ? `${config.divergence.thresholdPp}pp` : '停用'}`,
    `校準模式：${config.calibration.mode === 'none' ? '無（原始模型）' : config.calibration.mode === 'mild' ? `溫和（向 0.5 收縮 ${(config.calibration.mildShrinkFactor * 100).toFixed(0)}%）` : '完整'}`,
    `投注紀律：賠率 ${config.discipline.minOdds}–${config.discipline.maxOdds}，串關 ${config.discipline.optimalParlayLegsMin}–${config.discipline.optimalParlayLegsMax} 腳，單注上限 ${(config.discipline.maxStakeFraction * 100).toFixed(1)}%`,
  ]
  return lines.join('\n')
}

/** 候選條件旗標 Candidate condition flags */
export type CandidateFlags = {
  oddsInRange: boolean
  directionsAlign: boolean
  notDiverging: boolean
  modelDataSufficient: boolean
}

export const DIVERGENCE_FLAG = '待質化確認'
export const INSUFFICIENT_DATA_FLAG = '模型資料不足，僅供參考'
