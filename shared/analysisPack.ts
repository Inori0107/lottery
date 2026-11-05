import { DIVERGENCE_FLAG, marketActionLabel } from './decision'
import { formatConfigSummary, getModelConfig } from './modelConfig'
import { disciplineLabel, sportLabel } from './sports'
import type {
  BetMarket,
  FixtureSummary,
  MarketQuote,
  MultiMarketQuote,
  QuoteResponse,
} from './types'
import { marketLabelFor } from './types'

export const INSUFFICIENT_MODEL_FLAG = '模型資料不足，僅供參考'
export const STALE_DATA_WARNING_DAYS = 7

export type AdjustmentLookup = {
  market: BetMarket
  outcomeKey: string
  adjustedProbability: number
  deltaPct: number
  reasonCategory: string
}

export type AnalysisPackInput = {
  quote: QuoteResponse
  fixture?: Pick<
    FixtureSummary,
    | 'tslEventId'
    | 'sportradarId'
    | 'tournament'
    | 'startsAt'
    | 'oddsCapturedAt'
    | 'awayUid'
    | 'homeUid'
    | 'awayNameZh'
    | 'homeNameZh'
    | 'awayMatchStatus'
    | 'homeMatchStatus'
  > | null
  adjustments?: AdjustmentLookup[]
}

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`

const evText = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—'
  const formatted = value.toFixed(3)
  return value > 0 ? `+${formatted}` : formatted
}

const taipeiTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
}

const signedPct = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const adjustmentFor = (
  adjustments: AdjustmentLookup[] | undefined,
  market: BetMarket,
  outcomeKey: string,
) => adjustments?.find(item => item.market === market && item.outcomeKey === outcomeKey)

const winnerLines = (
  title: string,
  market: BetMarket,
  quote: MarketQuote,
  awayName: string,
  homeName: string,
  adjustments?: AdjustmentLookup[],
) => {
  const awayAdj = adjustmentFor(adjustments, market, 'away')
  const homeAdj = adjustmentFor(adjustments, market, 'home')
  const insufficient = quote.status === 'insufficient'
  const lines = [
    `## ${title}`,
    `狀態：${insufficient ? 'insufficient' : 'ok'}`,
    `決策：${marketActionLabel[quote.decision.action]}｜${quote.decision.reason}`,
  ]
  if (quote.divergenceFlag) lines.push(`發散警示：${quote.divergenceFlag}（差距 ${quote.divergencePp?.toFixed(1) ?? '—'}pp）`)
  if (quote.blendConfig) lines.push(`混合權重：市場 ${(quote.blendConfig.marketWeight * 100).toFixed(0)}% / 模型 ${(quote.blendConfig.modelWeight * 100).toFixed(0)}%`)
  if (insufficient) lines.push(`旗標：${INSUFFICIENT_MODEL_FLAG}`)
  const row = (
    side: '客' | '主',
    name: string,
    outcomeKey: 'away' | 'home',
    implied: number | null,
    marketProb: number | null,
    raw: number | null,
    calibrated: number | null,
    blended: number | null,
    ev: number | null,
    evBlended: number | null,
    adj?: AdjustmentLookup,
  ) =>
    `${side} ${name}  隱含 ${pct(implied)}  去水 ${pct(marketProb)}  模型原始 ${pct(raw)}  校準 ${pct(calibrated)}  混合 ${pct(blended)}  質化調整 ${adj ? `${pct(adj.adjustedProbability)}（${signedPct(adj.deltaPct)}%，${adj.reasonCategory}）` : '—'}  EV(校準) ${evText(ev)}  EV(混合) ${evText(evBlended)}`
  lines.push(row('客', awayName, 'away', quote.impliedAway, quote.marketAway, quote.probabilityAway, quote.probabilityCalibratedAway, quote.probabilityBlendedAway, quote.evAway, quote.evBlendedAway, awayAdj))
  lines.push(row('主', homeName, 'home', quote.impliedHome, quote.marketHome, quote.probabilityHome, quote.probabilityCalibratedHome, quote.probabilityBlendedHome, quote.evHome, quote.evBlendedHome, homeAdj))
  return lines
}

const multiLines = (
  title: string,
  market: BetMarket,
  quote: MultiMarketQuote | null,
  adjustments?: AdjustmentLookup[],
) => {
  if (!quote) return []
  const insufficient = quote.status === 'insufficient'
  const lines = [
    `## ${title}${quote.line === null ? '' : `  盤口 ${quote.line}`}`,
    `狀態：${insufficient ? 'insufficient' : 'ok'}`,
    `決策：${marketActionLabel[quote.decision.action]}｜${quote.decision.reason}`,
  ]
  if (quote.divergenceFlag) lines.push(`發散警示：${quote.divergenceFlag}`)
  if (quote.blendConfig) lines.push(`混合權重：市場 ${(quote.blendConfig.marketWeight * 100).toFixed(0)}% / 模型 ${(quote.blendConfig.modelWeight * 100).toFixed(0)}%`)
  if (quote.summary) lines.push(`摘要：${quote.summary}`)
  if (insufficient) lines.push(`旗標：${INSUFFICIENT_MODEL_FLAG}`)
  for (const outcome of quote.outcomes) {
    const adj = adjustmentFor(adjustments, market, outcome.key)
    const modelRaw = insufficient ? null : outcome.probability
    const calibrated = insufficient ? null : outcome.probabilityCalibrated
    const blended = insufficient ? null : outcome.probabilityBlended
    lines.push(
      `${outcome.label}  賠率 ${outcome.odds ?? '—'}  隱含 ${pct(outcome.implied)}  去水 ${pct(outcome.market)}  模型原始 ${pct(modelRaw)}  校準 ${pct(calibrated)}  混合 ${pct(blended)}  質化調整 ${adj ? `${pct(adj.adjustedProbability)}（${signedPct(adj.deltaPct)}%，${adj.reasonCategory}）` : '—'}  EV(校準) ${evText(outcome.ev)}  EV(混合) ${evText(outcome.evBlended)}`,
    )
  }
  return lines
}

export const quoteIsInsufficient = (quote: QuoteResponse) =>
  quote.matchWinner.status === 'insufficient'
  || quote.set1Winner.status === 'insufficient'
  || quote.warnings.some(warning => warning.includes('資料不足') || warning.includes('樣本'))

const playerStaleWarning = (lastPlayedOn: string | null, asOf: string): string | null => {
  if (!lastPlayedOn) return null
  const diff = Math.floor((Date.parse(`${asOf}T00:00:00+08:00`) - Date.parse(`${lastPlayedOn}T00:00:00+08:00`)) / 86_400_000)
  if (diff > STALE_DATA_WARNING_DAYS) return `⚠ 最近比賽距今 ${diff} 天`
  return null
}

export const formatAnalysisPack = ({ quote, fixture, adjustments }: AnalysisPackInput): string => {
  const pending = fixture
    && (fixture.awayMatchStatus === 'pending' || fixture.homeMatchStatus === 'pending')
  const insufficient = quoteIsInsufficient(quote) || pending || !quote.away.matchCount || !quote.home.matchCount
  const awayLastPlayed = quote.away.lastPlayedOn ?? '—'
  const homeLastPlayed = quote.home.lastPlayedOn ?? '—'
  const awayStale = playerStaleWarning(quote.away.lastPlayedOn, quote.asOf)
  const homeStale = playerStaleWarning(quote.home.lastPlayedOn, quote.asOf)
  const config = getModelConfig()
  const lines = [
    '# 分析包',
    `運動：${sportLabel[quote.sport]}／${disciplineLabel[quote.discipline]}`,
    `賽事：${fixture?.tournament ?? '—'}`,
    `運彩場次：${fixture?.tslEventId ?? '—'}`,
    `Sportradar：${fixture?.sportradarId ?? '—'}（客 uid=${fixture?.awayUid ?? '—'} 主 uid=${fixture?.homeUid ?? '—'}）`,
    `開賽（台北）：${taipeiTime(fixture?.startsAt ?? null)}`,
    `客：${quote.away.name}${fixture?.awayNameZh ? `／${fixture.awayNameZh}` : ''}  id=${quote.away.id}  n全場=${quote.away.matchCount}  n第一局=${quote.away.set1Count}  最近比賽=${awayLastPlayed}${awayStale ? `  ${awayStale}` : ''}`,
    `主：${quote.home.name}${fixture?.homeNameZh ? `／${fixture.homeNameZh}` : ''}  id=${quote.home.id}  n全場=${quote.home.matchCount}  n第一局=${quote.home.set1Count}  最近比賽=${homeLastPlayed}${homeStale ? `  ${homeStale}` : ''}`,
    `模型：${quote.modelVersion}  方法：${quote.set1Method}  資料截至：${quote.dataThrough}  報價日：${quote.asOf}`,
    `校準模式：${quote.calibrationMode ?? config.calibration.mode}`,
    `賠率擷取：${taipeiTime(fixture?.oddsCapturedAt ?? null)}`,
    `資料旗標：${insufficient ? INSUFFICIENT_MODEL_FLAG : '模型資料充足'}`,
  ]
  if (pending) lines.push('對局對應：待確認（不會用譯名自動配對）')
  if (quote.warnings.length > 0) {
    lines.push('警告：')
    for (const warning of quote.warnings) lines.push(`- ${warning}`)
  }
  lines.push('')
  lines.push(formatConfigSummary(config))
  lines.push('')
  lines.push(...winnerLines(marketLabelFor(quote.sport, 'match'), 'match', quote.matchWinner, quote.away.name, quote.home.name, adjustments))
  lines.push('')
  lines.push(...winnerLines(marketLabelFor(quote.sport, 'set1'), 'set1', quote.set1Winner, quote.away.name, quote.home.name, adjustments))
  const extras: Array<{ title: string, market: BetMarket, quote: MultiMarketQuote | null }> = [
    { title: marketLabelFor(quote.sport, 'totals'), market: 'totals', quote: quote.totalPoints },
    { title: marketLabelFor(quote.sport, 'handicap'), market: 'handicap', quote: quote.pointsHandicap },
    { title: marketLabelFor(quote.sport, 'correctScore'), market: 'correctScore', quote: quote.correctScore },
    { title: marketLabelFor(quote.sport, 'setHandicap'), market: 'setHandicap', quote: quote.setHandicap },
    { title: marketLabelFor(quote.sport, 'set1Totals'), market: 'set1Totals', quote: quote.set1TotalPoints },
    { title: marketLabelFor(quote.sport, 'set1Handicap'), market: 'set1Handicap', quote: quote.set1PointsHandicap },
  ]
  for (const extra of extras) {
    const block = multiLines(extra.title, extra.market, extra.quote, adjustments)
    if (block.length === 0) continue
    lines.push('')
    lines.push(...block)
  }
  return `${lines.join('\n').trim()}\n`
}
