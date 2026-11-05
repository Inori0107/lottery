import type { BetMarket, Discipline, Sport } from './types'

export type ParlayConfig = {
  maxFragileLegs: number
  maxSameCompetitionRoundLegs: number
  shortOddsThreshold: number
  suggestSplitAtLegs: number
  splitSize: number
  badmintonFragileHandicapAbs: number
  volleyballFragileHandicapAbs: number
  fragileSetHandicapAbs: number
}

export const DEFAULT_PARLAY_CONFIG: ParlayConfig = {
  maxFragileLegs: 1,
  maxSameCompetitionRoundLegs: 2,
  shortOddsThreshold: 1.2,
  suggestSplitAtLegs: 5,
  splitSize: 3,
  badmintonFragileHandicapAbs: 4.5,
  volleyballFragileHandicapAbs: 6.5,
  fragileSetHandicapAbs: 0.5,
}

export type ParlayLeg = {
  id: string
  fixtureId: number | null
  sport: Sport
  discipline: Discipline
  tournament: string
  round: string
  awayName: string
  homeName: string
  market: BetMarket
  outcomeKey: string
  outcomeLabel: string
  line: number | null
  odds: number
  probability: number | null
  probabilitySource: 'model' | 'market'
  dataSufficient: boolean
  startsAt: string | null
}

export type ParlayWarning = {
  code: 'fragile' | 'same-round' | 'short-odds' | 'correlated' | 'insufficient'
  message: string
}

export type ParlaySplit = {
  labels: string[]
  combinedOdds: number
  combinedProbability: number | null
  ev: number | null
  stakeCost: number
}

const combinations = <T>(items: T[], size: number): T[][] => {
  if (size === 0) return [[]]
  if (items.length < size) return []
  const [head, ...tail] = items
  if (head === undefined) return []
  return [
    ...combinations(tail, size - 1).map(rest => [head, ...rest]),
    ...combinations(tail, size),
  ]
}

export const isFragileLeg = (leg: ParlayLeg, config: ParlayConfig = DEFAULT_PARLAY_CONFIG) => {
  if (leg.market === 'set1' || leg.market === 'set1Totals' || leg.market === 'set1Handicap') return true
  if (leg.market === 'totals') return true
  const line = Math.abs(leg.line ?? 0)
  if (leg.market === 'setHandicap') return line <= config.fragileSetHandicapAbs
  if (leg.market === 'handicap') {
    const limit = leg.sport === 'volleyball' ? config.volleyballFragileHandicapAbs : config.badmintonFragileHandicapAbs
    return line <= limit
  }
  return false
}

const product = (values: number[]) => values.reduce((total, value) => total * value, 1)

const combinedEv = (legs: ParlayLeg[]) => {
  if (legs.some(leg => leg.probability === null)) return { combinedProbability: null, ev: null }
  const combinedProbability = product(legs.map(leg => leg.probability as number))
  return { combinedProbability, ev: combinedProbability * product(legs.map(leg => leg.odds)) - 1 }
}

export const evaluateParlay = (legs: ParlayLeg[], config: ParlayConfig = DEFAULT_PARLAY_CONFIG) => {
  const warnings: ParlayWarning[] = []
  const fragile = legs.filter(leg => isFragileLeg(leg, config))
  if (fragile.length > config.maxFragileLegs) {
    warnings.push({
      code: 'fragile',
      message: `容易因延長局／deuce 翻盤的腳有 ${fragile.length} 個（建議最多 ${config.maxFragileLegs} 個）：${fragile.map(leg => `${leg.awayName}/${leg.homeName} ${leg.outcomeLabel}`).join('、')}`,
    })
  }

  const grouped = new Map<string, ParlayLeg[]>()
  for (const leg of legs) {
    const key = `${leg.tournament}::${leg.round || '未知輪次'}`
    const list = grouped.get(key) ?? []
    list.push(leg)
    grouped.set(key, list)
  }
  for (const [key, group] of grouped) {
    if (group.length <= config.maxSameCompetitionRoundLegs) continue
    const [tournament, round] = key.split('::')
    warnings.push({
      code: 'same-round',
      message: `同一賽事與輪次「${tournament}／${round}」有 ${group.length} 腳（建議最多 ${config.maxSameCompetitionRoundLegs} 腳）`,
    })
  }

  const shorts = legs.filter(leg => leg.odds <= config.shortOddsThreshold)
  if (shorts.length > 0) {
    warnings.push({
      code: 'short-odds',
      message: `有 ${shorts.length} 腳賠率 ≤ ${config.shortOddsThreshold.toFixed(2)}：${shorts.map(leg => `${leg.outcomeLabel} ${leg.odds}`).join('、')}`,
    })
  }

  const byMatch = new Map<number, ParlayLeg[]>()
  for (const leg of legs) {
    if (leg.fixtureId === null) continue
    const list = byMatch.get(leg.fixtureId) ?? []
    list.push(leg)
    byMatch.set(leg.fixtureId, list)
  }
  for (const group of byMatch.values()) {
    if (group.length < 2) continue
    warnings.push({
      code: 'correlated',
      message: `同一場 ${group[0]?.awayName} 對 ${group[0]?.homeName} 選了 ${group.length} 腳，結果高度相關`,
    })
  }

  const insufficient = legs.filter(leg => !leg.dataSufficient || leg.probabilitySource === 'market')
  if (insufficient.length > 0) {
    warnings.push({
      code: 'insufficient',
      message: `有 ${insufficient.length} 腳沒有模型機率，改用去水盤口機率：${insufficient.map(leg => leg.outcomeLabel).join('、')}`,
    })
  }

  const combinedOdds = legs.length === 0 ? 0 : product(legs.map(leg => leg.odds))
  const { combinedProbability, ev } = combinedEv(legs)
  const splits: ParlaySplit[] = []
  if (legs.length >= config.suggestSplitAtLegs) {
    for (const combo of combinations(legs, config.splitSize)) {
      const stats = combinedEv(combo)
      splits.push({
        labels: combo.map(leg => `${leg.awayName}/${leg.homeName} ${leg.outcomeLabel}`),
        combinedOdds: product(combo.map(leg => leg.odds)),
        combinedProbability: stats.combinedProbability,
        ev: stats.ev,
        stakeCost: 1,
      })
    }
  }

  return {
    warnings,
    combinedOdds,
    combinedProbability,
    ev,
    splitHint: splits.length > 0
      ? `已選 ${legs.length} 腳，建議拆成 ${config.splitSize} 串組合（共 ${splits.length} 組；每組金額 1 則合計 ${splits.length}）`
      : null,
    splits,
  }
}

export const parlayProbabilityFromQuote = (
  dataSufficient: boolean,
  modelProbability: number | null,
  marketProbability: number | null,
) => {
  if (dataSufficient && modelProbability !== null) {
    return { probability: modelProbability, probabilitySource: 'model' as const, dataSufficient: true }
  }
  return {
    probability: marketProbability,
    probabilitySource: 'market' as const,
    dataSufficient: false,
  }
}
