import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sample from '../data/raw/tsl/sample.json'
import { openLedger } from '../server/db/ledger'
import { importTslPayload } from '../server/models/liveSync'
import { readTodayFixtures } from '../server/models/ledgerStore'
import { tslPayloadSchema } from '../server/models/tsl'
import { buildTslBookmarklet } from '../app/utils/tslBookmarklet'

const dirs: string[] = []

const tempLedger = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lottery-tsl-'))
  dirs.push(dir)
  return openLedger(join(dir, 'ledger.sqlite'))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const eventOf = (overrides: Record<string, unknown> = {}) => ({
  idfoevent: 'e-naive',
  idfosporttype: 'BAD',
  participantname_away: '客隊',
  participantname_home: '主隊',
  tsstart: '2026-10-22T18:00:00',
  tournamentname: '測試賽男子單打',
  externalreference: 'sr:match:10000001',
  markets: [{
    name: '不讓分',
    istradable: true,
    ismainline: true,
    selections: [
      { name: '客勝', hadvalue: 'A', currentpriceup: '1', currentpricedown: '1' },
      { name: '主勝', hadvalue: 'H', currentpriceup: '1', currentpricedown: '1' },
    ],
  }],
  ...overrides,
})

describe('匯入後的今日對局', () => {
  it('captured sample 在台北當天會出現在 /api/fixtures 清單', () => {
    const ledger = tempLedger()
    const payload = tslPayloadSchema.parse(sample)
    const summary = importTslPayload(ledger, null, payload, new Date('2026-10-22T05:19:13.206Z'))
    expect(summary.received).toBe(payload.events.length)
    expect(summary.imported).toBe(13)
    expect(summary.skipped).toEqual([])

    const today = readTodayFixtures(
      ledger,
      null,
      fixture => fixture.discipline === 'MS' || fixture.discipline === 'WS',
      new Date('2026-10-22T12:00:00+08:00'),
    )
    expect(today.date).toBe('2026-10-22')
    expect(today.fixtures).toHaveLength(13)
    expect(today.message).toBeNull()
    expect(today.lastImportSummary?.imported).toBe(13)

    const nextDay = readTodayFixtures(
      ledger,
      null,
      fixture => fixture.discipline === 'MS' || fixture.discipline === 'WS',
      new Date('2026-10-23T12:00:00+08:00'),
    )
    expect(nextDay.date).toBe('2026-10-23')
    expect(nextDay.fixtures).toHaveLength(0)
    expect(nextDay.message).toContain('匯入 13 場')
    ledger.close()
  })

  it('伺服器在 UTC 時，沒有時區的 tsstart 仍列在台北今天', () => {
    const ledger = tempLedger()
    const previous = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      const summary = importTslPayload(ledger, null, {
        capturedAt: '2026-10-22T04:00:00.000Z',
        date: '20261022',
        english: [{
          idfoevent: 'e-naive',
          participantname_away: 'Away Player',
          participantname_home: 'Home Player',
        }],
        events: [eventOf()],
      }, new Date('2026-10-22T04:00:00.000Z'))
      expect(summary.imported).toBe(1)
      const today = readTodayFixtures(
        ledger,
        null,
        fixture => fixture.discipline === 'MS',
        new Date('2026-10-22T12:00:00+08:00'),
      )
      expect(today.fixtures).toHaveLength(1)
      expect(today.fixtures[0]?.startsAt).toBe('2026-10-22T10:00:00.000Z')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
    ledger.close()
  })

  it('隔日清晨的場次仍出現在台北「今天」清單', () => {
    const ledger = tempLedger()
    importTslPayload(ledger, null, {
      capturedAt: '2026-10-22T12:00:00.000Z',
      date: '20261022',
      english: [{
        idfoevent: 'e-late',
        participantname_away: 'Away Player',
        participantname_home: 'Home Player',
      }],
      events: [eventOf({
        idfoevent: 'e-late',
        tsstart: '2026-10-23T02:30:00+08:00',
        externalreference: 'sr:match:10000002',
      })],
    }, new Date('2026-10-22T12:00:00+08:00'))

    const today = readTodayFixtures(
      ledger,
      null,
      () => true,
      new Date('2026-10-22T20:00:00+08:00'),
    )
    expect(today.date).toBe('2026-10-22')
    expect(today.fixtures).toHaveLength(1)
    ledger.close()
  })

  it('全部略過時今日清單要說明原因，而不是只有空白文案', () => {
    const ledger = tempLedger()
    const summary = importTslPayload(ledger, null, {
      capturedAt: '2026-10-22T12:00:00.000Z',
      date: '20261022',
      english: [],
      events: [eventOf({ tournamentname: '法國公開賽男子雙打' })],
    }, new Date('2026-10-22T12:00:00+08:00'))
    expect(summary.imported).toBe(0)
    expect(summary.skipped[0]?.reason).toBe('不是男單或女單')

    const today = readTodayFixtures(ledger, null, () => true, new Date('2026-10-22T12:00:00+08:00'))
    expect(today.fixtures).toEqual([])
    expect(today.message).toContain('收到 1 場')
    expect(today.message).toContain('不是男單或女單')
    ledger.close()
  })
})

describe('書籤小工具', () => {
  it('會抓羽球排球網球，並在 window.open 前先聽 tsl-ready', () => {
    const source = decodeURIComponent(buildTslBookmarklet('http://localhost:3000'))
    expect(source).toContain('BAD')
    expect(source).toContain('VOL')
    expect(source).toContain('TEN')
    expect(source).toContain('TENN')
    expect(source).toContain('"UK"')
    expect(source).toContain('"EN"')
    expect(source.indexOf('addEventListener')).toBeLessThan(source.indexOf('window.open'))
    expect(source).toContain('mixedContent')
    expect(source).toContain('+08:00')
  })
})
