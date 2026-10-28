import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '../server/db/ledger'
import {
  importTslFixtures,
  insertBet,
  insertTicket,
  listFixtures,
  validateSimulatedLeg,
} from '../server/models/ledgerStore'
import { parseTslPayload, tslPayloadSchema } from '../server/models/tsl'
import {
  buildBadmintonOdds,
  inputForMarket,
  inputsForFixture,
  sameFixtureVersion,
  sourcesForInputs,
} from '../app/utils/badmintonMarkets'
import {
  fixturePresentMarkets,
  type FixtureSummary,
  type TicketLegInput,
} from '../shared/types'
import {
  gamePointDistributions,
  probabilityAbove,
} from '../server/models/rally'
import sample from '../data/raw/tsl/sample.json'
import { quotePlayersWithForm } from '../server/models/quote'

const now = Date.now()
const capturedAt = new Date(now - 1000).toISOString()
const startsAt = new Date(now + 3_600_000).toISOString()
const fixtureDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
}).format(new Date(startsAt))
const original = structuredClone(sample.events[0]!)
const totals = original.markets.find((m) => m.name.startsWith('[總分]大小'))!
const withFuture = (markets: unknown[]) => ({
  ...original,
  tsstart: startsAt,
  markets: markets.map((raw) =>
    raw && typeof raw === 'object' ? { ...raw, tsbetend: startsAt } : raw,
  ),
})
const parse = (markets: unknown[], time = capturedAt) =>
  parseTslPayload(
    tslPayloadSchema.parse({
      ...sample,
      capturedAt: time,
      events: [withFuture(markets)],
    }),
  ).fixtures[0]!
const totalLine = (line: number, id: string) => ({
  ...totals,
  idfomarket: id,
  name: `[總分]大小 ${line}`,
  selections: totals.selections.map((s, i) => ({
    ...s,
    name: `${i ? '小' : '大'} ${line}`,
    currenthandicap: String(line),
  })),
})
const ledgers: ReturnType<typeof openLedger>[] = []
afterEach(() => {
  for (const db of ledgers.splice(0)) db.close()
})
const ledger = () => {
  const db = openLedger(':memory:')
  ledgers.push(db)
  return db
}
const seed = (
  db: ReturnType<typeof openLedger>,
  markets: unknown[],
  time = capturedAt,
) => {
  const parsed = parse(markets, time)
  importTslFixtures(db, [parsed], () => null, time)
  return listFixtures(db, null, fixtureDate)[0]!
}
const legFor = (fixture: FixtureSummary): TicketLegInput => {
  const market = fixture.markets!.find((m) => m.status === 'available')!
  const s = market.selections[0]!
  return {
    fixtureId: fixture.sportradarId,
    sport: fixture.sport,
    discipline: fixture.discipline,
    awayName: fixture.awayName,
    homeName: fixture.homeName,
    startsAt: fixture.startsAt,
    market: market.market!,
    outcomeKey: s.key,
    outcomeLabel: s.label,
    line: market.line,
    odds: s.odds!,
    probability: 0.6,
    ev: 999,
    action: 'watch',
    modelVersion: 'test',
    sourceMarketId: market.id,
    oddsCapturedAt: fixture.oddsCapturedAt,
  }
}

describe('完整市場匯入與前端接線', () => {
  it('保留同類多條線、來源 ID、選項、截止時間，並可切換送出', () => {
    const db = ledger()
    const fixture = seed(db, [
      { ...totalLine(78.5, 'main'), ismainline: true },
      totalLine(80.5, 'alternate'),
    ])
    expect(fixture.markets).toHaveLength(2)
    expect(fixture.markets![1]).toMatchObject({
      id: 'alternate',
      line: 80.5,
      bettingEndsAt: startsAt,
      status: 'available',
    })
    const inputs = inputsForFixture(fixture, { totals: 'alternate' })
    expect(buildBadmintonOdds(inputs).body.totalOdds).toEqual({
      line: 80.5,
      over: 1.72,
      under: 1.72,
    })
    expect(sourcesForInputs(inputs, fixture.oddsCapturedAt, {})).toEqual({
      totals: { marketId: 'alternate', capturedAt },
    })
  })
  it('第一局大小從解析、保存一路帶到計算參數', () => {
    const fixture = seed(ledger(), [
      { ...totalLine(36.5, 'first'), name: '[第1局]大小 36.5' },
    ])
    const inputs = inputsForFixture(fixture)
    expect(inputs.map((m) => m.kind)).toEqual(['set1Totals'])
    expect(buildBadmintonOdds(inputs).body.set1TotalOdds).toEqual({
      line: 36.5,
      over: 1.72,
      under: 1.72,
    })
  })
  it('不完整、未知與畸形市場保留原因，不阻擋其他完整玩法', () => {
    const score = original.markets.find((m) => m.name === '正確比數')!
    const fixture = seed(ledger(), [
      totals,
      { ...score, selections: score.selections.slice(0, 1) },
      { name: '單雙', selections: [] },
      { name: '壞掉的市場', selections: 'bad' },
    ])
    expect(fixture.markets!.map((m) => m.status)).toEqual([
      'available',
      'invalid',
      'unsupported',
      'invalid',
    ])
    expect(inputsForFixture(fixture).map((m) => m.kind)).toEqual(['totals'])
    expect(buildBadmintonOdds(inputsForFixture(fixture)).errors).toEqual({})
    expect(fixture.ignoredMarkets).toHaveLength(3)
  })
  it('整數線有明確原因；讓分可從結構化欄位讀取', () => {
    const invalid = parse([totalLine(80, 'integer')])
    expect(invalid.markets![0]).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('.5'),
    })
    const handicap = original.markets.find((m) =>
      m.name.startsWith('[總分]讓分'),
    )!
    const parsed = parse([
      {
        ...handicap,
        name: '[總分]讓分',
        selections: handicap.selections.map((s) => ({
          ...s,
          name: s.hadvalue === 'A' ? '客' : '主',
        })),
      },
    ])
    expect(parsed.odds.handicap?.homeLine).toBe(4.5)
  })
  it('手動輸入只略過有錯的玩法，維持其他完整玩法可計算', () => {
    const total = inputForMarket('totals')
    total.line = 80.5
    total.selections.forEach((s) => (s.value = 1.9))
    const score = inputForMarket('correctScore')
    score.selections[0]!.value = 2
    const result = buildBadmintonOdds([total, score])
    expect(result.body.totalOdds).toBeDefined()
    expect(result.body.correctScoreOdds).toBeUndefined()
    expect(result.errors.correctScore).toContain('已略過')
  })
  it('第一局分數包含整場波動，避免套用全場校準', () => {
    expect(
      probabilityAbove(gamePointDistributions(0.57, 0.05, 0.35).total, 35.5),
    ).toBeCloseTo(0.449906646, 8)
    const player = (id: string) => ({
      id,
      name: id,
      elo: 1500,
      matchCount: 100,
      set1Count: 100,
      lastPlayedOn: fixtureDate,
      game1Recent: [],
    })
    const model = {
      method: 'bo3' as const,
      coefficients: [0, 0, 0] as [number, number, number],
      bins: [],
      shrinkMode: 'raw' as const,
      rally: {
        coefficients: [0, 0.001] as [number, number],
        sigma: 0.05,
        tau: 0.35,
      },
      totalsCalibration: [
        { lo: 0, hi: 1, n: 100, predicted: 0.5, actual: 0.9 },
      ],
    }
    const quote = quotePlayersWithForm(
      player('A'),
      player('B'),
      model,
      { set1Totals: { line: 36.5, over: 1.9, under: 1.9 } },
      fixtureDate,
    )
    expect(quote.set1TotalPoints!.calibrationApplied).toBe(false)
    expect(quote.set1TotalPoints!.outcomes[0]!.probabilityCalibrated).toBe(
      quote.set1TotalPoints!.outcomes[0]!.probability,
    )
    expect(quote.set1TotalPoints!.decision.action).not.toBe('candidate')
  })
})

describe('空市場、停賣與版本', () => {
  it('截止時間無法解析時保留原因，不開放計算或模擬', () => {
    const event = withFuture([totals])
    event.markets = [{ ...totals, tsbetend: 'invalid-time' }]
    const fixture = parseTslPayload(
      tslPayloadSchema.parse({ ...sample, capturedAt, events: [event] }),
    ).fixtures[0]!
    expect(fixture.markets![0]).toMatchObject({
      status: 'invalid',
      reason: '來源截止時間格式不符',
    })
    expect(fixturePresentMarkets(fixture.odds)).toEqual([])
  })
  it('相同賠率版本更正選手或項目時，舊結果也必須失效', () => {
    const fixture = seed(ledger(), [totals])
    expect(sameFixtureVersion(fixture, { ...fixture })).toBe(true)
    expect(
      sameFixtureVersion(fixture, { ...fixture, awayName: '更正選手' }),
    ).toBe(false)
    expect(sameFixtureVersion(fixture, { ...fixture, discipline: 'WS' })).toBe(
      false,
    )
    expect(
      sameFixtureVersion(fixture, {
        ...fixture,
        away: { id: 'relinked' } as FixtureSummary['away'],
      }),
    ).toBe(false)
  })
  it('全部停賣或空快照都不會回退到舊賠率', () => {
    const db = ledger()
    const first = seed(db, [totals])
    const later = new Date(now).toISOString()
    const closed = seed(db, [{ ...totals, istradable: false }], later)
    expect(fixturePresentMarkets(closed.odds)).toEqual([])
    expect(closed.markets![0]!.status).toBe('unavailable')
    expect(closed.oddsCapturedAt).toBe(later)
    expect(sameFixtureVersion(first, closed)).toBe(false)
    const empty = seed(db, [], new Date(now + 1).toISOString())
    expect(empty.markets).toEqual([])
    expect(fixturePresentMarkets(empty.odds)).toEqual([])
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM market_snapshots').get(),
    ).toEqual({ n: 3 })
  })
  it('較舊抓取資料不能蓋掉新的停賣狀態', () => {
    const db = ledger()
    seed(db, [{ ...totals, istradable: false }], new Date(now).toISOString())
    const result = seed(db, [totals], capturedAt)
    expect(result.markets![0]!.status).toBe('unavailable')
  })
  it('事件或選項明確停賣時，不視為可計算市場', () => {
    const event = withFuture([totals])
    event.istradable = false
    const result = parseTslPayload(
      tslPayloadSchema.parse({ ...sample, capturedAt, events: [event] }),
    )
    expect(result.fixtures[0]!.markets![0]!.status).toBe('unavailable')
    const selectionClosed = parse([
      {
        ...totals,
        selections: totals.selections.map((s, i) => ({
          ...s,
          istradable: i !== 0,
        })),
      },
    ])
    expect(selectionClosed.markets![0]!.status).toBe('unavailable')
  })
})

describe('送出模擬單時的來源驗證', () => {
  it('有效替代盤口可以建立單場模擬，保存來源版本並依實際 odds 計算 EV', () => {
    const db = ledger()
    const fixture = seed(db, [totalLine(80.5, 'alternate')])
    const leg = legFor(fixture)
    const ticket = insertTicket(db, {
      ledgerKind: 'sim',
      stake: 100,
      legs: [leg],
    })
    expect(ticket.legs[0]).toMatchObject({
      sourceMarketId: 'alternate',
      oddsCapturedAt: capturedAt,
      ev: 0.6 * 1.72 - 1,
    })
  })
  it('新版本、停賣、逾期、已開賽及改 odds 皆拒絕，且不扣本金', () => {
    const db = ledger()
    const fixture = seed(db, [totals])
    const leg = legFor(fixture)
    expect(() => validateSimulatedLeg(db, { ...leg, odds: 9 })).toThrow(
      '盤口或賠率已變動',
    )
    expect(() => validateSimulatedLeg(db, leg, now + 31 * 60_000)).toThrow(
      '賠率已過期',
    )
    seed(db, [{ ...totals, istradable: false }], new Date(now).toISOString())
    expect(() =>
      insertTicket(db, { ledgerKind: 'sim', stake: 100, legs: [leg] }),
    ).toThrow('版本已更新')
    expect(() =>
      validateSimulatedLeg(db, {
        ...leg,
        oddsCapturedAt: new Date(now).toISOString(),
      }),
    ).toThrow('已停賣')
    db.prepare("UPDATE fixtures SET status='ended'").run()
    expect(() => validateSimulatedLeg(db, leg)).toThrow('已開賽')
    expect(
      db.prepare("SELECT balance FROM bankrolls WHERE kind='sim'").get(),
    ).toEqual({ balance: 10000 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tickets').get()).toEqual({
      n: 0,
    })
  })
  it('人工記錄調整賠率後重算 EV，不沿用表單舊值', () => {
    const db = ledger()
    const leg = legFor(seed(db, [totals]))
    const bet = insertBet(db, { ...leg, odds: 2, stake: 100 })
    expect(bet.ev).toBeCloseTo(0.2)
  })
})
