import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import { quotePlayersWithForm } from '../server/models/quote'
import { deployableCalibration, fitMonotoneCalibration } from '../server/models/calibration'
import { runDiscipline, type BacktestMatch } from '../server/models/backtest'
import { expectedScore } from '../server/models/elo'
import { savePrediction } from '../server/models/predictionLedger'
import { deleteTicket, getBankroll, insertTicket, listTickets, settleOpenBets, settleOpenTickets, taipeiDate } from '../server/models/ledgerStore'
import { quoteSelection } from '../shared/quoteSelection'
import { performanceSummary } from '../shared/performance'
import { conservativeEligibility } from '../shared/strategy'
import { suggestedStake } from '../shared/parlay'
import type { QuoteResponse, TicketLegInput } from '../shared/types'

const day = taipeiDate(new Date())
const player = (id: string, elo = 1500, lastPlayedOn = day) => ({ id, name: id, elo, matchCount: 100, set1Count: 100, lastPlayedOn, game1Recent: [] })
const model = { method: 'bo3' as const, coefficients: [0, 0, 0] as [number, number, number], bins: [], shrinkMode: 'raw' as const }
const asymmetric = [{ lo: 0, hi: .5, n: 100, predicted: .4, actual: .35 }, { lo: .5, hi: 1, n: 100, predicted: .6, actual: .7 }]
const databases: ReturnType<typeof openLedger>[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const database = () => { const db = openLedger(':memory:'); databases.push(db); return db }

const seedPrediction = (db: ReturnType<typeof openLedger>, id = 1): TicketLegInput => {
  const startsAt = new Date(Date.now() + 3_600_000).toISOString(), capturedAt = new Date(Date.now() - 1000).toISOString()
  db.prepare(`INSERT INTO fixtures (sportradar_id,tsl_event_id,sport,discipline,tournament,starts_at,play_date,away_name,home_name,away_player_id,home_player_id,updated_at) VALUES (?,'test','badminton','MS','Test',?,?,'A','B','A','B',?)`).run(id, startsAt, day, capturedAt)
  db.prepare('INSERT INTO market_snapshots VALUES (?, ?, ?)').run(id, capturedAt, JSON.stringify([{ id: 'main', market: 'match', status: 'available', line: null, selections: [{ key: 'away', odds: 1.1 }, { key: 'home', odds: 8 }] }]))
  const a = player('A', 1700), b = player('B', 1300)
  const quoted = quotePlayersWithForm(a, b, { ...model, validationReady: true,
    matchCalibration: [{ lo: 0, hi: 1, n: 1000, predicted: .9, actual: .97 }],
    matchReliability: [{ lo: .8, hi: 1, n: 1000, predicted: .97, actual: .98 }],
  }, { match: { away: 1.1, home: 8 } }, day)
  const response: QuoteResponse = { ...quoted, sport: 'badminton', discipline: 'MS', modelVersion: 'synthetic-test-only', set1Method: 'bo3',
    dataThrough: day, asOf: day, shrinkEnabled: false, sourceUrl: 'test', away: a, home: b, isHome: false, warnings: [], setHandicap: null }
  const frozen = savePrediction(db, response, id, {}, { match: 'main' })
  const selected = quoteSelection(frozen, 'match', 'away')!
  return { fixtureId: id, quoteId: frozen.quoteId, sourceMarketId: 'main', oddsCapturedAt: capturedAt, sport: 'badminton', discipline: 'MS',
    awayName: 'A', homeName: 'B', startsAt, market: 'match', outcomeKey: 'away', outcomeLabel: 'A', line: null,
    odds: selected.odds, probability: selected.probability, ev: 999, action: 'candidate', modelVersion: response.modelVersion }
}

describe('羽球推論與獨立校準', () => {
  it('同一位選手交換客主後，全場、第一局與有方向的分數機率不變', () => {
    const a = player('A', 1600), b = player('B', 1500)
    const m = { ...model, matchCalibration: asymmetric, game1Calibration: asymmetric, handicapCalibration: asymmetric,
      rally: { coefficients: [0.01, .001] as [number, number], sigma: .05, tau: .35 } }
    const first = quotePlayersWithForm(a, b, m, { match: { away: 1.9, home: 1.9 }, handicap: { awayLine: -4.5, away: 1.9, home: 1.9 }, totals: { line: 80.5, over: 1.9, under: 1.9 } }, day)
    const swapped = quotePlayersWithForm(b, a, m, { match: { away: 1.9, home: 1.9 }, handicap: { awayLine: 4.5, away: 1.9, home: 1.9 }, totals: { line: 80.5, over: 1.9, under: 1.9 } }, day)
    expect(first.matchWinner.probabilityCalibratedAway).toBeCloseTo(swapped.matchWinner.probabilityCalibratedHome!, 12)
    expect(first.matchWinner.evAway).toBeCloseTo(swapped.matchWinner.evHome!, 12)
    expect(first.set1Winner.probabilityCalibratedAway).toBeCloseTo(swapped.set1Winner.probabilityCalibratedHome!, 12)
    expect(first.pointsHandicap!.outcomes[0]!.probabilityCalibrated).toBeCloseTo(swapped.pointsHandicap!.outcomes[1]!.probabilityCalibrated, 12)
    expect(first.totalPoints!.outcomes[0]!.probability).toBeCloseTo(swapped.totalPoints!.outcomes[0]!.probability, 12)
  })
  it('raw 不會被強制改成 inactivity，缺乏驗證時不升級候選', () => {
    const q = quotePlayersWithForm(player('A', 1700, '2026-01-01'), player('B', 1500, '2026-03-02'), { ...model, validationReady: false }, { match: { away: 1.5, home: 3 } }, '2026-03-02')
    expect(q.matchWinner.probabilityAway).toBe(expectedScore(1700, 1500))
    expect(q.matchWinner.decision.action).not.toBe('candidate')
  })
  it('不部署舊 test 校準，新的校準器單調且依樣本加權', () => {
    expect(deployableCalibration({ calibration: { match: asymmetric } })).toEqual({})
    expect(deployableCalibration({ evaluationProtocol: 'temporal-calibration-v1', calibration: { match: asymmetric } }).match).toEqual(asymmetric)
    const fitted = fitMonotoneCalibration([{ lo: 0, hi: .5, n: 10, predicted: .4, actual: .9 }, { lo: .5, hi: 1, n: 30, predicted: .8, actual: .8 }])
    expect(fitted.map(b => b.actual)).toEqual([.825, .825])
  })
  it('校準資料與最終測試隔離，同日結果不進入同日預測', () => {
    const matches: BacktestMatch[] = Array.from({ length: 40 }, (_, i) => ({ matchId: String(i), discipline: 'MS', playedOn: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
      sideAId: 'A', sideBId: 'B', includeMatch: true, includeGame1: true, sideAWonMatch: i % 3 !== 0, sideAWonGame1: i % 2 === 0, games: [] }))
    matches.splice(1, 0, { ...matches[0]!, matchId: 'same-day' })
    const first = runDiscipline('MS', matches)
    const altered = matches.map(m => m.playedOn > first.payload.calibrationEnd! ? { ...m, sideAWonMatch: !m.sideAWonMatch, sideAWonGame1: !m.sideAWonGame1 } : m)
    const changed = runDiscipline('MS', altered)
    expect(first.payload.trainEnd <= first.payload.validEnd && first.payload.validEnd <= first.payload.calibrationEnd!).toBe(true)
    expect(first.payload.counts.calibration.match).toBeGreaterThan(0)
    expect(first.payload.calibration).toEqual(changed.payload.calibration)
    const sameDay = first.predictions.filter(p => p.marketType === 'match_winner' && p.featureAsOf === matches[0]!.playedOn)
    expect(sameDay[0]!.pSideA).toBe(sameDay[1]!.pSideA)
    expect(first.modelVersion).not.toBe(changed.modelVersion)
  })
})

describe('前瞻模擬、風控與不可抹除的績效', () => {
  it('保存單場預測，拒絕改機率、改來源版本或改選手後送出', () => {
    const db = database(), leg = seedPrediction(db)
    expect(() => insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [{ ...leg, probability: .99 }] })).toThrow('預測不符')
    expect(() => insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [{ ...leg, action: 'pass' }] })).toThrow('預測不符')
    const ticket = insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [leg] })
    expect(ticket.kind).toBe('single')
    expect(ticket.legs[0]!.quoteId).toBe(leg.quoteId)
    expect(ticket.legs[0]!.marketProbability).not.toBeNull()
    db.prepare("UPDATE fixtures SET home_player_id = 'C'").run()
    expect(() => insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [leg] })).toThrow('選手已變動')
  })
  it('封存不退本、不刪預測，仍可結算且計入績效；實注分開', () => {
    const db = database(), leg = seedPrediction(db)
    const ticket = insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [leg] })
    deleteTicket(db, ticket.id)
    expect(getBankroll(db, 'sim').balance).toBe(9900)
    expect(listTickets(db)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM prediction_snapshots').get()).toEqual({ n: 1 })
    db.prepare("UPDATE fixtures SET status='ended', score='21-15 21-15'").run()
    settleOpenBets(db); settleOpenTickets(db)
    expect(getBankroll(db, 'sim').balance).toBe(10010)
    const stats = performanceSummary(listTickets(db, null, 'sim', true))
    expect(stats.profit).toBeCloseTo(10)
    expect(stats.comparison.n).toBe(1)
    expect(stats.roi).toBeCloseTo(.1)
    expect(listTickets(db, null, 'real', true)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM ticket_events').get()).toEqual({ n: 3 })
  })
  it('保守模式在伺服器檢查門檻與同場／單注上限，Kelly 零值及上限正確', () => {
    const db = database(), leg = seedPrediction(db)
    const stored = JSON.parse((db.prepare('SELECT response_json FROM prediction_snapshots').get() as { response_json: string }).response_json)
    expect(conservativeEligibility(stored.matchWinner, 'away').eligible).toBe(true)
    expect(() => insertTicket(db, { ledgerKind: 'sim', strategy: 'conservative', stake: 101, legs: [leg] })).toThrow('每注')
    insertTicket(db, { ledgerKind: 'sim', strategy: 'conservative', stake: 50, legs: [leg] })
    expect(() => insertTicket(db, { ledgerKind: 'sim', strategy: 'conservative', stake: 60, legs: [leg] })).toThrow('同一場次')
    const q = { combinedOdds: 1.1, combinedProbability: .95, ev: .045, kelly: .1125, reason: null }
    expect(suggestedStake(10000, q, 'kelly')).toBe(100)
    expect(suggestedStake(10000, { ...q, ev: -.01, kelly: null }, 'kelly')).toBe(0)
  })
  it('每日上限包含已封存及其他研究單，不因拆單而重置', () => {
    const db = database()
    for (let i = 1; i <= 5; i++) {
      const ticket = insertTicket(db, { ledgerKind: 'sim', stake: 90, legs: [seedPrediction(db, i)] })
      deleteTicket(db, ticket.id)
    }
    expect(() => insertTicket(db, { ledgerKind: 'sim', strategy: 'conservative', stake: 90, legs: [seedPrediction(db, 6)] })).toThrow('今日')
    expect(getBankroll(db, 'sim').balance).toBe(9550)
  })
})
