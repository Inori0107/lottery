export const ADJUSTMENT_CATEGORIES = [
  'injury',
  'fatigue',
  'head_to_head',
  'style',
  'recent_upset',
  'other',
] as const

export type AdjustmentCategory = typeof ADJUSTMENT_CATEGORIES[number]

export const adjustmentCategoryLabel: Record<AdjustmentCategory, string> = {
  injury: '傷病',
  fatigue: '疲勞',
  head_to_head: '對戰',
  style: '風格',
  recent_upset: '近況冷門',
  other: '其他',
}

export type ProbabilityAdjustment = {
  id: string
  fixtureId: number
  market: string
  outcomeKey: string
  deltaPct: number
  reasonCategory: AdjustmentCategory
  note: string
  createdAt: string
}

export const applyAdjustment = (raw: number | null, deltaPct: number) => {
  if (raw === null) return null
  return Math.min(0.999, Math.max(0.001, raw + deltaPct / 100))
}
