import type { BetStatus, LedgerKind, ParlayQuote, SlipLeg } from './types'
import { MAX_TICKET_FRACTION } from './strategy'

export const MAX_PARLAY_LEGS = 10
export const MIN_PARLAY_LEGS = 2
export const KELLY_FRACTION = 0.25

export type ParlayError = {
  reason: string
}

export const roundOdds = (odds: number) => Math.round(odds * 100) / 100

export const combinedOdds = (legs: Array<{ odds: number }>) =>
  roundOdds(legs.reduce((product, leg) => product * leg.odds, 1))

export const combinedProbability = (legs: Array<{ probability: number | null }>) => {
  if (legs.some(leg => leg.probability === null)) return null
  return legs.reduce((product, leg) => product * (leg.probability ?? 0), 1)
}

export const parlayExpectedValue = (probability: number | null, odds: number) =>
  probability === null ? null : probability * odds - 1

export const fractionalKelly = (ev: number | null, odds: number, fraction = KELLY_FRACTION) => {
  if (ev === null || ev <= 0 || odds <= 1) return null
  return Math.max(0, (ev / (odds - 1)) * fraction)
}

export const validateParlayLegs = (legs: SlipLeg[]): ParlayError | null => {
  if (legs.length === 0) return { reason: '過關單是空的' }
  if (legs.length > MAX_PARLAY_LEGS) return { reason: `過關最多 ${MAX_PARLAY_LEGS} 腿` }
  const fixtureIds = legs.map(leg => leg.fixtureId).filter((id): id is number => id !== null)
  if (fixtureIds.length !== legs.length) return { reason: '過關每腿都要對上運彩場次' }
  if (new Set(fixtureIds).size !== fixtureIds.length) return { reason: '同場不可串關' }
  return null
}

export const quoteParlay = (legs: SlipLeg[]): ParlayQuote | ParlayError => {
  const error = validateParlayLegs(legs)
  if (error) return error
  const odds = combinedOdds(legs)
  const probability = combinedProbability(legs)
  const ev = parlayExpectedValue(probability, odds)
  return {
    combinedOdds: odds,
    combinedProbability: probability,
    ev,
    kelly: fractionalKelly(ev, odds),
    reason: legs.length === 1 ? '研究用單場模擬；不代表運彩開放單場投注。' : '跨場獨立假設，僅供研究；過關不當候選。',
  }
}

export const isParlayQuote = (value: ParlayQuote | ParlayError): value is ParlayQuote =>
  'combinedOdds' in value

export const suggestedStake = (
  balance: number,
  quote: ParlayQuote,
  mode: 'flat' | 'percent' | 'kelly',
  flatAmount = 100,
  percent = MAX_TICKET_FRACTION,
) => {
  if (mode === 'percent') return Math.max(0, Math.round(balance * percent * 100) / 100)
  if (mode === 'kelly') {
    const fraction = quote.kelly
    if (fraction === null) return 0
    return Math.max(0, Math.round(balance * Math.min(fraction, MAX_TICKET_FRACTION) * 100) / 100)
  }
  return Math.min(flatAmount, balance)
}

export const canAfford = (kind: LedgerKind, balance: number, stake: number) =>
  kind !== 'sim' || stake <= balance + 1e-9

export const resolveParlayTicket = (
  legs: Array<{ status: BetStatus, odds: number }>,
  stake: number,
) => {
  if (legs.some(leg => leg.status === 'open')) {
    return { status: 'open' as const, payout: null as number | null, combinedOdds: combinedOdds(legs) }
  }
  const remaining = legs.filter(leg => leg.status !== 'void')
  if (remaining.length === 0) {
    return { status: 'void' as const, payout: stake, combinedOdds: 1 }
  }
  if (remaining.some(leg => leg.status === 'lost')) {
    return { status: 'lost' as const, payout: 0, combinedOdds: combinedOdds(remaining) }
  }
  const odds = combinedOdds(remaining)
  return { status: 'won' as const, payout: Math.round(stake * odds * 100) / 100, combinedOdds: odds }
}

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

export type ParlayWarningLeg = {
  fixtureId: number | null
  sport: SlipLeg['sport']
  tournament?: string
  round?: string
  awayName: string
  homeName: string
  market: SlipLeg['market']
  outcomeLabel: string
  line: number | null
  odds: number
  probability: number | null
  probabilitySource?: 'model' | 'market'
  dataSufficient?: boolean
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

export const isFragileLeg = (leg: ParlayWarningLeg, config: ParlayConfig = DEFAULT_PARLAY_CONFIG) => {
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

const combinedEv = (legs: ParlayWarningLeg[]) => {
  if (legs.some(leg => leg.probability === null)) return { combinedProbability: null, ev: null }
  const combinedProbability = product(legs.map(leg => leg.probability as number))
  return { combinedProbability, ev: combinedProbability * product(legs.map(leg => leg.odds)) - 1 }
}

export const evaluateParlay = (legs: ParlayWarningLeg[], config: ParlayConfig = DEFAULT_PARLAY_CONFIG) => {
  const warnings: ParlayWarning[] = []
  const fragile = legs.filter(leg => isFragileLeg(leg, config))
  if (fragile.length > config.maxFragileLegs) {
    warnings.push({
      code: 'fragile',
      message: `容易因延長局／deuce 翻盤的腳有 ${fragile.length} 個（建議最多 ${config.maxFragileLegs} 個）：${fragile.map(leg => `${leg.awayName}/${leg.homeName} ${leg.outcomeLabel}`).join('、')}`,
    })
  }

  const grouped = new Map<string, ParlayWarningLeg[]>()
  for (const leg of legs) {
    const key = `${leg.tournament ?? '未知賽事'}::${leg.round || '未知輪次'}`
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

  const byMatch = new Map<number, ParlayWarningLeg[]>()
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

  const insufficient = legs.filter(leg => leg.dataSufficient === false || leg.probabilitySource === 'market')
  if (insufficient.length > 0) {
    warnings.push({
      code: 'insufficient',
      message: `有 ${insufficient.length} 腳沒有模型機率，改用去水盤口機率：${insufficient.map(leg => leg.outcomeLabel).join('、')}`,
    })
  }

  const odds = legs.length === 0 ? 0 : product(legs.map(leg => leg.odds))
  const { combinedProbability: probability, ev } = combinedEv(legs)
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
    combinedOdds: odds,
    combinedProbability: probability,
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
