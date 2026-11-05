import type Database from 'better-sqlite3'
import type { BetMarket, BetStatus, FixtureStatus, Sport } from '../../shared/types'
import { closingOddsAfterPrediction, closingLineValue, parseGameScores, settleBet, type OddsSnapshot } from './settle'
import { listPredictionSnapshots, type PredictionSnapshot } from './predictions'

type Sqlite = Database.Database

export const REVIEW_SMALL_N = 30

export type ReviewFilters = {
  sport?: Sport | ''
  market?: BetMarket | ''
  competition?: string
  action?: string
  dataSufficient?: 'all' | 'yes' | 'no'
  from?: string
  to?: string
}

export type ProbabilitySource = 'modelRaw' | 'qualitativeAdjusted' | 'marketVigRemoved'

export type ReviewRow = PredictionSnapshot & {
  fixtureStatus: FixtureStatus | null
  startsAt: string | null
  score: string
  result: BetStatus | 'unresolved'
  hit: boolean | null
  closingOdds: number | null
  closingIsProxy: boolean
  clv: number | null
  profit: number | null
}

type CalibrationBin = {
  lo: number
  hi: number
  n: number
  predicted: number | null
  actual: number | null
}

export type SourceMetrics = {
  source: ProbabilitySource
  label: string
  n: number
  brier: number | null
  logLoss: number | null
  calibration: CalibrationBin[]
  warning: string | null
}

export type ReviewReport = {
  n: number
  nSmallWarning: string | null
  hitRate: number | null
  roi: number | null
  staked: number
  profit: number
  clvCount: number
  averageClv: number | null
  sources: SourceMetrics[]
  rows: ReviewRow[]
  groups: Array<{ key: string, n: number }>
}

const clampProb = (value: number) => Math.min(0.999, Math.max(0.001, value))

const probabilityOf = (row: PredictionSnapshot, source: ProbabilitySource) => {
  if (source === 'modelRaw') return row.modelRaw
  if (source === 'qualitativeAdjusted') return row.qualitativeAdjusted
  return row.marketVigRemoved
}

const binsFor = (points: Array<{ p: number, y: number }>): CalibrationBin[] => {
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
  return edges.slice(0, -1).map((lo, index) => {
    const hi = edges[index + 1]!
    const inBin = points.filter(point => point.p >= lo && (index === edges.length - 2 ? point.p <= hi : point.p < hi))
    const predicted = inBin.length === 0 ? null : inBin.reduce((sum, point) => sum + point.p, 0) / inBin.length
    const actual = inBin.length === 0 ? null : inBin.reduce((sum, point) => sum + point.y, 0) / inBin.length
    return { lo, hi, n: inBin.length, predicted, actual }
  })
}

const sourceMetrics = (rows: ReviewRow[], source: ProbabilitySource, label: string): SourceMetrics => {
  const points = rows.flatMap((row) => {
    if (row.result !== 'won' && row.result !== 'lost') return []
    const p = probabilityOf(row, source)
    if (p === null) return []
    return [{ p: clampProb(p), y: row.result === 'won' ? 1 : 0 }]
  })
  const n = points.length
  const brier = n === 0 ? null : points.reduce((sum, point) => sum + (point.p - point.y) ** 2, 0) / n
  const logLoss = n === 0
    ? null
    : points.reduce((sum, point) => sum + (
      -(point.y * Math.log(point.p) + (1 - point.y) * Math.log(1 - point.p))
    ), 0) / n
  return {
    source,
    label,
    n,
    brier,
    logLoss,
    calibration: binsFor(points),
    warning: n < REVIEW_SMALL_N ? `樣本 ${n} 太少，不足以下結論` : null,
  }
}

const snapshotsFor = (ledger: Sqlite, fixtureId: number, market: string): OddsSnapshot[] =>
  (ledger.prepare(`
    SELECT outcome_key, line, odds, captured_at FROM odds_snapshots
    WHERE fixture_id = ? AND market = ?
    ORDER BY captured_at
  `).all(fixtureId, market) as Array<{ outcome_key: string, line: number | null, odds: number, captured_at: string }>)
    .map(row => ({ outcomeKey: row.outcome_key, line: row.line, odds: row.odds, capturedAt: row.captured_at }))

const inDateRange = (value: string, from?: string, to?: string) => {
  const day = new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

export const loadReviewRows = (ledger: Sqlite, filters: ReviewFilters = {}): ReviewRow[] => {
  const snapshots = listPredictionSnapshots(ledger)
  const fixtureStmt = ledger.prepare('SELECT status, score, starts_at, tournament FROM fixtures WHERE sportradar_id = ?')
  return snapshots.flatMap((snapshot) => {
    if (filters.sport && snapshot.sport !== filters.sport) return []
    if (filters.market && snapshot.market !== filters.market) return []
    if (filters.competition && snapshot.tournament !== filters.competition) return []
    if (filters.action && snapshot.decisionAction !== filters.action) return []
    if (filters.dataSufficient === 'yes' && !snapshot.dataSufficient) return []
    if (filters.dataSufficient === 'no' && snapshot.dataSufficient) return []
    if (!inDateRange(snapshot.predictedAt, filters.from, filters.to)) return []
    const fixture = fixtureStmt.get(snapshot.fixtureId) as {
      status: FixtureStatus
      score: string
      starts_at: string
      tournament: string
    } | undefined
    const games = fixture ? parseGameScores(fixture.score) : []
    let result: ReviewRow['result'] = 'unresolved'
    if (!fixture || fixture.status === 'pre' || fixture.status === 'live') result = 'unresolved'
    else if (fixture.status === 'void') result = 'void'
    else {
      result = settleBet(
        { market: snapshot.market as BetMarket, outcomeKey: snapshot.outcomeKey, line: snapshot.line },
        games,
        snapshot.sport as Sport,
      )
    }
    const closing = fixture
      ? closingOddsAfterPrediction(
        snapshotsFor(ledger, snapshot.fixtureId, snapshot.market),
        { outcomeKey: snapshot.outcomeKey, line: snapshot.line },
        fixture.starts_at,
        snapshot.predictedAt,
      )
      : null
    const hit = result === 'unresolved' || result === 'void' || snapshot.decisionAction === 'pass'
      ? null
      : result === 'won'
    const profit = snapshot.placed && snapshot.odds !== null && (result === 'won' || result === 'lost')
      ? (result === 'won' ? snapshot.odds - 1 : -1)
      : null
    return [{
      ...snapshot,
      fixtureStatus: fixture?.status ?? null,
      startsAt: fixture?.starts_at ?? null,
      score: fixture?.score ?? '',
      result,
      hit,
      closingOdds: closing?.odds ?? null,
      closingIsProxy: closing !== null,
      clv: snapshot.odds === null ? null : closingLineValue(snapshot.odds, closing?.odds ?? null),
      profit,
    }]
  })
}

export const buildReviewReport = (ledger: Sqlite, filters: ReviewFilters = {}): ReviewReport => {
  const rows = loadReviewRows(ledger, filters)
  const decidedHits = rows.filter(row => row.hit !== null)
  const placed = rows.filter(row => row.profit !== null)
  const staked = placed.length
  const profit = placed.reduce((sum, row) => sum + (row.profit ?? 0), 0)
  const clvs = rows.flatMap(row => (row.clv === null ? [] : [row.clv]))
  const n = rows.length
  return {
    n,
    nSmallWarning: n < REVIEW_SMALL_N ? `總樣本 ${n} 太少，不足以從覆盤下結論` : null,
    hitRate: decidedHits.length === 0 ? null : decidedHits.filter(row => row.hit).length / decidedHits.length,
    roi: staked === 0 ? null : profit / staked,
    staked,
    profit: Math.round(profit * 1000) / 1000,
    clvCount: clvs.length,
    averageClv: clvs.length === 0 ? null : clvs.reduce((sum, value) => sum + value, 0) / clvs.length,
    sources: [
      sourceMetrics(rows, 'modelRaw', '模型原始'),
      sourceMetrics(rows, 'qualitativeAdjusted', '質化調整'),
      sourceMetrics(rows, 'marketVigRemoved', '盤口去水'),
    ],
    rows,
    groups: [
      ...new Set(rows.map(row => row.sport)),
    ].map(key => ({ key, n: rows.filter(row => row.sport === key).length })),
  }
}

export const formatReviewSummary = (
  report: ReviewReport,
  periodLabel: string,
) => {
  const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
  const num = (value: number | null, digits = 3) => (value === null ? '—' : value.toFixed(digits))
  const lines = [
    `# 覆盤摘要（${periodLabel}）`,
    `樣本 ${report.n}${report.nSmallWarning ? ` ｜${report.nSmallWarning}` : ''}`,
    `命中率 ${pct(report.hitRate)}（不含不投／未完賽／作廢）`,
    `已標記投注 ROI ${pct(report.roi)}，單位獲利 ${num(report.profit)}，n=${report.staked}`,
    `CLV（收盤代理，運彩書籤同步；沒有預測後快照則為空）平均 ${pct(report.averageClv)}，有 CLV ${report.clvCount} 筆`,
    '',
    '三個機率來源（僅實際完賽結果，無合成資料）：',
  ]
  for (const source of report.sources) {
    lines.push(`- ${source.label} n=${source.n} Brier ${num(source.brier)} LogLoss ${num(source.logLoss)}${source.warning ? ` ｜${source.warning}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}
