import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import { insertAdjustment } from '../server/models/adjustments'
import { recordPredictionSnapshot } from '../server/models/predictions'
import { buildReviewReport, formatReviewSummary } from '../server/models/review'
import { closingOddsAfterPrediction, settleBet, settleParlayStatus } from '../server/models/settle'
import { oddsOnlyQuote } from '../server/models/analysisPack'
import type { FixtureSummary } from '../shared/types'

const fixture = (overrides: Partial<FixtureSummary> = {}): FixtureSummary => ({
  sport: 'badminton',
  sportradarId: 101,
  tslEventId: 'e1',
  discipline: 'MS',
  tournament: 'Test Open',
  startsAt: '2026-10-22T10:50:00.000Z',
  status: 'ended',
  score: '21-18 21-19',
  awayName: 'Away',
  homeName: 'Home',
  awayNameZh: '',
  homeNameZh: '',
  awayUid: 1,
  homeUid: 2,
  away: { id: 'a', name: 'Away', elo: 1500, matchCount: 2, set1Count: 2, lastPlayedOn: null },
  home: { id: 'b', name: 'Home', elo: 1500, matchCount: 2, set1Count: 2, lastPlayedOn: null },
  awaySuggested: null,
  homeSuggested: null,
  awayMatchStatus: 'confirmed',
  homeMatchStatus: 'confirmed',
  odds: {
    match: { away: 1.8, home: 2.0 },
    set1: { away: 1.7, home: 2.1 },
    totals: null,
    handicap: null,
    correctScore: null,
    setHandicap: null,
    set1Totals: null,
    set1Handicap: null,
  },
  oddsCapturedAt: '2026-10-22T08:00:00.000Z',
  ...overrides,
})

describe('結算', () => {
  it('第 1 盤可在全場未打完時先結', () => {
    expect(settleBet({ market: 'set1', outcomeKey: 'away', line: null }, [{ away: 21, home: 18 }])).toBe('won')
  })

  it('排球五盤三勝與局數讓分', () => {
    const games = [
      { away: 25, home: 20 },
      { away: 25, home: 22 },
      { away: 20, home: 25 },
      { away: 25, home: 18 },
    ]
    expect(settleBet({ market: 'match', outcomeKey: 'away', line: null }, games, 'volleyball')).toBe('won')
    expect(settleBet({ market: 'setHandicap', outcomeKey: 'away', line: -1.5 }, games, 'volleyball')).toBe('won')
    expect(settleBet({ market: 'set1Totals', outcomeKey: 'over', line: 44.5 }, games, 'volleyball')).toBe('won')
  })

  it('過關任一輸則輸，全贏才贏，有作廢無輸則整張作廢', () => {
    expect(settleParlayStatus(['won', 'won'])).toBe('won')
    expect(settleParlayStatus(['won', 'lost'])).toBe('lost')
    expect(settleParlayStatus(['won', 'void'])).toBe('void')
    expect(settleParlayStatus(['won', 'open'])).toBe('open')
  })
})

describe('覆盤', () => {
  it('沒有預測後的賠率快照時 CLV 為空，並並陳三個機率來源', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-review-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    ledger.prepare(`
      INSERT INTO fixtures (
        sportradar_id, tsl_event_id, discipline, tournament, starts_at, play_date,
        away_name, home_name, status, score, updated_at
      ) VALUES (101, 'e1', 'MS', 'Test Open', '2026-10-22T10:50:00.000Z', '2026-10-22', 'Away', 'Home', 'ended', '21-18 21-19', '2026-10-22T12:00:00.000Z')
    `).run()
    ledger.prepare(`
      INSERT INTO odds_snapshots (fixture_id, market, outcome_key, line, odds, captured_at)
      VALUES (101, 'match', 'away', NULL, 1.8, '2026-10-22T08:00:00.000Z'),
             (101, 'match', 'home', NULL, 2.0, '2026-10-22T08:00:00.000Z')
    `).run()
    insertAdjustment(ledger, {
      fixtureId: 101,
      market: 'match',
      outcomeKey: 'away',
      deltaPct: 5,
      reasonCategory: 'injury',
    })
    const quoted = oddsOnlyQuote(fixture())
    quoted.matchWinner.probabilityAway = 0.55
    quoted.matchWinner.probabilityHome = 0.45
    quoted.matchWinner.status = 'ok'
    quoted.matchWinner.decision = { action: 'candidate', side: 'away', reason: 'test' }
    recordPredictionSnapshot(ledger, fixture(), quoted, '2026-10-22T08:00:00.000Z')
    const report = buildReviewReport(ledger, { sport: 'badminton' })
    expect(report.n).toBeGreaterThan(0)
    expect(report.nSmallWarning).toContain('太少')
    const away = report.rows.find(row => row.market === 'match' && row.outcomeKey === 'away')
    expect(away?.clv).toBeNull()
    expect(away?.qualitativeAdjusted).toBeCloseTo(0.6)
    expect(away?.marketVigRemoved).not.toBeNull()
    expect(report.sources.map(source => source.label)).toEqual(['模型原始', '質化調整', '盤口去水', '市場混合'])
    const summary = formatReviewSummary(report, '日 2026-10-22')
    expect(summary).toContain('覆盤摘要')
    expect(summary).toContain('收盤代理')
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('預測之後、開賽之前的快照才當 CLV 代理', () => {
    const closing = closingOddsAfterPrediction(
      [
        { outcomeKey: 'away', line: null, odds: 1.8, capturedAt: '2026-10-22T08:00:00.000Z' },
        { outcomeKey: 'home', line: null, odds: 2.0, capturedAt: '2026-10-22T08:00:00.000Z' },
        { outcomeKey: 'away', line: null, odds: 1.65, capturedAt: '2026-10-22T10:00:00.000Z' },
        { outcomeKey: 'home', line: null, odds: 2.2, capturedAt: '2026-10-22T10:00:00.000Z' },
        { outcomeKey: 'away', line: null, odds: 1.5, capturedAt: '2026-10-22T11:00:00.000Z' },
      ],
      { outcomeKey: 'away', line: null },
      '2026-10-22T10:50:00.000Z',
      '2026-10-22T08:00:00.000Z',
    )
    expect(closing?.odds).toBe(1.65)
  })
})
