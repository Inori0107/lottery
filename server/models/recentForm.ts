/**
 * 近期狀態特徵計算
 * Recent Form Features Calculation
 */

import { DEFAULT_MODEL_CONFIG, type RecentFormConfig } from '../../shared/modelConfig'
import { daysBetween } from './eloCore'

export type RecentFormData = {
  /** 最近比賽結果 (1=勝, 0=敗) */
  recentResults: number[]
  /** 每場比賽的日期 */
  matchDates?: string[]
  /** 選手 Elo */
  elo: number
  /** 對手 Elo (如有) */
  opponentElos?: number[]
}

export type RecentFormFeatures = {
  /** 時間加權勝率 */
  recencyWeightedWinRate: number
  /** 近期狀態分數 (相對於預期表現的正負值) */
  formScore: number
  /** 疲勞警示 */
  fatigueWarning: boolean
  /** 近期比賽數量 */
  recentMatchCount: number
  /** 近期爆冷次數 (以弱勝強) */
  recentUpsets: number
  /** 近期被爆冷次數 (以強敗弱) */
  recentUpsetLosses: number
  /** 資料是否充足 */
  dataSufficient: boolean
}

const expectedScore = (ratingA: number, ratingB: number) =>
  1 / (1 + 10 ** ((ratingB - ratingA) / 400))

/**
 * 計算時間衰減權重
 * 越近的比賽權重越高
 */
export const timeDecayWeight = (
  daysSinceMatch: number,
  halfLifeDays: number = DEFAULT_MODEL_CONFIG.recentForm.timeDecayHalfLifeDays,
): number => {
  return 0.5 ** (daysSinceMatch / halfLifeDays)
}

/**
 * 計算時間加權勝率
 * Recency-weighted win rate
 */
export const recencyWeightedWinRate = (
  results: number[],
  matchDates: string[] | undefined,
  asOf: string,
  config: RecentFormConfig = DEFAULT_MODEL_CONFIG.recentForm,
): number => {
  if (results.length === 0) return 0.5

  const recentResults = results.slice(-config.recentMatchCount)
  const recentDates = matchDates?.slice(-config.recentMatchCount)

  let weightedSum = 0
  let totalWeight = 0

  for (let i = 0; i < recentResults.length; i++) {
    let weight = 1
    if (recentDates && recentDates[i]) {
      const days = daysBetween(recentDates[i], asOf)
      weight = timeDecayWeight(days, config.timeDecayHalfLifeDays)
    } else {
      weight = timeDecayWeight(i * 7, config.timeDecayHalfLifeDays)
    }

    weightedSum += recentResults[i]! * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0.5
}

/**
 * 計算近期狀態分數
 * 正值表示表現優於預期，負值表示表現低於預期
 */
export const calculateFormScore = (
  results: number[],
  elo: number,
  opponentElos: number[] | undefined,
  config: RecentFormConfig = DEFAULT_MODEL_CONFIG.recentForm,
): number => {
  if (results.length === 0 || !opponentElos || opponentElos.length === 0) return 0

  const recentResults = results.slice(-config.recentMatchCount)
  const recentOpponents = opponentElos.slice(-config.recentMatchCount)

  let formScore = 0
  for (let i = 0; i < recentResults.length && i < recentOpponents.length; i++) {
    const expected = expectedScore(elo, recentOpponents[i]!)
    const actual = recentResults[i]!
    formScore += actual - expected
  }

  return formScore / Math.max(1, recentResults.length)
}

/**
 * 計算疲勞指標
 * 檢查近期比賽數量是否過多
 */
export const checkFatigue = (
  matchDates: string[] | undefined,
  asOf: string,
  config: RecentFormConfig = DEFAULT_MODEL_CONFIG.recentForm,
): boolean => {
  if (!matchDates || matchDates.length === 0) return false

  const cutoffDate = new Date(asOf)
  cutoffDate.setDate(cutoffDate.getDate() - config.fatigueWindowDays)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  const recentGames = matchDates.filter(date => date >= cutoffStr).length
  return recentGames >= config.fatigueThreshold
}

/**
 * 計算近期爆冷次數
 * 爆冷定義：Elo 差距超過門檻但仍獲勝
 */
export const countRecentUpsets = (
  results: number[],
  elo: number,
  opponentElos: number[] | undefined,
  config: RecentFormConfig = DEFAULT_MODEL_CONFIG.recentForm,
): { upsets: number; upsetLosses: number } => {
  if (!opponentElos || opponentElos.length === 0) {
    return { upsets: 0, upsetLosses: 0 }
  }

  const recentResults = results.slice(-config.recentMatchCount)
  const recentOpponents = opponentElos.slice(-config.recentMatchCount)

  let upsets = 0
  let upsetLosses = 0

  for (let i = 0; i < recentResults.length && i < recentOpponents.length; i++) {
    const eloDiff = elo - recentOpponents[i]!
    const won = recentResults[i] === 1

    if (eloDiff < -config.upsetEloDiff && won) {
      upsets++
    }
    if (eloDiff > config.upsetEloDiff && !won) {
      upsetLosses++
    }
  }

  return { upsets, upsetLosses }
}

/**
 * 計算完整的近期狀態特徵
 */
export const calculateRecentFormFeatures = (
  data: RecentFormData,
  asOf: string,
  config: RecentFormConfig = DEFAULT_MODEL_CONFIG.recentForm,
): RecentFormFeatures => {
  const recentCount = Math.min(data.recentResults.length, config.recentMatchCount)
  const dataSufficient = recentCount >= 3

  const winRate = recencyWeightedWinRate(data.recentResults, data.matchDates, asOf, config)
  const formScore = calculateFormScore(data.recentResults, data.elo, data.opponentElos, config)
  const fatigueWarning = checkFatigue(data.matchDates, asOf, config)
  const { upsets, upsetLosses } = countRecentUpsets(data.recentResults, data.elo, data.opponentElos, config)

  return {
    recencyWeightedWinRate: winRate,
    formScore,
    fatigueWarning,
    recentMatchCount: recentCount,
    recentUpsets: upsets,
    recentUpsetLosses: upsetLosses,
    dataSufficient,
  }
}

/**
 * 格式化近期狀態摘要
 */
export const formatRecentFormSummary = (features: RecentFormFeatures): string => {
  const lines: string[] = []

  lines.push(`近期狀態：${features.recentMatchCount} 場，時間加權勝率 ${(features.recencyWeightedWinRate * 100).toFixed(1)}%`)

  if (features.formScore !== 0) {
    const direction = features.formScore > 0 ? '優於' : '低於'
    lines.push(`狀態分數：${direction}預期 ${Math.abs(features.formScore).toFixed(2)}`)
  }

  if (features.fatigueWarning) {
    lines.push('⚠️ 疲勞警示：近期比賽密集')
  }

  if (features.recentUpsets > 0) {
    lines.push(`近期爆冷：${features.recentUpsets} 次以弱勝強`)
  }

  if (features.recentUpsetLosses > 0) {
    lines.push(`近期被爆冷：${features.recentUpsetLosses} 次以強敗弱`)
  }

  if (!features.dataSufficient) {
    lines.push('近期資料不足（少於 3 場）')
  }

  return lines.join('\n')
}
