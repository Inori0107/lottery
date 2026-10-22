import { describe, expect, it } from 'vitest'
import sample from '../data/raw/tsl/sample.json'
import {
  fixtureOddsRows,
  fractionalToDecimal,
  parseTslPayload,
  sportradarMatchId,
  tslDiscipline,
  tslPayloadSchema,
} from '../server/models/tsl'

const parsedSample = () => parseTslPayload(tslPayloadSchema.parse(sample))

describe('TSL helpers', () => {
  it('converts fractional prices to rounded decimal odds', () => {
    expect(fractionalToDecimal('17', '10')).toBe(2.7)
    expect(fractionalToDecimal('1', '4')).toBe(1.25)
    expect(fractionalToDecimal('0', '4')).toBeNull()
    expect(fractionalToDecimal(null, '4')).toBeNull()
  })

  it('reads the Sportradar match id from the external reference', () => {
    expect(sportradarMatchId('sr:match:75825222')).toBe(75825222)
    expect(sportradarMatchId('betradar:75825222')).toBeNull()
    expect(sportradarMatchId(null)).toBeNull()
  })

  it('maps Chinese tournament names to singles disciplines', () => {
    expect(tslDiscipline('法國公開賽男子單打')).toBe('MS')
    expect(tslDiscipline('法國公開賽女子單打')).toBe('WS')
    expect(tslDiscipline('法國公開賽男子雙打')).toBeNull()
  })
})

describe('parseTslPayload', () => {
  it('parses every singles event in the captured sample', () => {
    const { fixtures, skipped } = parsedSample()
    expect(fixtures).toHaveLength(13)
    expect(skipped).toEqual([])
  })

  it('keeps away and home orientation and all markets', () => {
    const fixture = parsedSample().fixtures.find(item => item.sportradarId === 75825222)
    expect(fixture).toMatchObject({
      tslEventId: '3500901.1',
      discipline: 'WS',
      startsAt: '2026-10-22T10:50:00.000Z',
      awayName: 'Blichfeldt, Mia',
      homeName: 'Han, Yue',
      awayNameZh: '布里西費爾特',
      homeNameZh: '韓悅',
    })
    expect(fixture?.odds).toEqual({
      match: { away: 2.7, home: 1.25 },
      game1: { away: 2.3, home: 1.35 },
      totals: { line: 76.5, over: 1.68, under: 1.75 },
      handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
      correctScore: { '2:0': 4.85, '2:1': 5.65, '1:2': 3.05, '0:2': 1.7 },
    })
  })

  it('stores handicap rows with the away line', () => {
    const rows = fixtureOddsRows({
      match: null,
      game1: null,
      totals: null,
      handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
      correctScore: null,
    })
    expect(rows).toEqual([
      { market: 'handicap', outcomeKey: 'away', line: 8.5, odds: 1.7 },
      { market: 'handicap', outcomeKey: 'home', line: 8.5, odds: 1.73 },
    ])
  })

  it('skips events without a Sportradar reference', () => {
    const [first] = sample.events
    const { fixtures, skipped } = parseTslPayload(tslPayloadSchema.parse({
      ...sample,
      events: [{ ...first, externalreference: null }],
    }))
    expect(fixtures).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.reason).toBe('沒有 Sportradar 場次編號')
  })
})
