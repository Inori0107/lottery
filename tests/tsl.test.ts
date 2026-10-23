import { describe, expect, it } from 'vitest'
import sample from '../data/raw/tsl/sample.json'
import { getSportByTslCode } from '../shared/sports'
import {
  addCalendarDays,
  belongsOnTaipeiListingDay,
  inTaipeiCouponWindow,
  parseTslDateTime,
  taipeiDate,
} from '../shared/tslTime'
import {
  fixtureOddsRows,
  fractionalToDecimal,
  parseTslPayload,
  sportradarMatchId,
  tslDiscipline,
  tslPayloadSchema,
} from '../server/models/tsl'

const parsedSample = () => parseTslPayload(tslPayloadSchema.parse(sample))

const eventOf = (overrides: Record<string, unknown> = {}) => ({
  idfoevent: '3500893.1',
  idfosporttype: 'BAD',
  participantname_away: '奈良岡功大',
  participantname_home: '阿尤什.謝蒂',
  tsstart: '2026-10-22T18:00:00.000+08:00',
  tournamentname: '法國公開賽男子單打',
  externalreference: 'sr:match:75880062',
  markets: [{
    name: '不讓分',
    istradable: true,
    ismainline: true,
    selections: [
      { name: '客勝', hadvalue: 'A', currentpriceup: '17', currentpricedown: '10' },
      { name: '主勝', hadvalue: 'H', currentpriceup: '1', currentpricedown: '4' },
    ],
  }],
  ...overrides,
})

describe('TSL helpers', () => {
  it('converts fractional prices to rounded decimal odds', () => {
    expect(fractionalToDecimal('17', '10')).toBe(2.7)
    expect(fractionalToDecimal('1', '4')).toBe(1.25)
    expect(fractionalToDecimal('0', '4')).toBeNull()
    expect(fractionalToDecimal(null, '4')).toBeNull()
  })

  it('reads the Sportradar match id from the external reference', () => {
    expect(sportradarMatchId('sr:match:75825222')).toBe(75825222)
    expect(sportradarMatchId('prefix sr:match:75825222 extra')).toBe(75825222)
    expect(sportradarMatchId('betradar:75825222')).toBe(75825222)
    expect(sportradarMatchId(null)).toBeNull()
    expect(sportradarMatchId('other:123')).toBeNull()
  })

  it('maps TSL sport codes including aliases used on the live site', () => {
    expect(getSportByTslCode('BAD')).toBe('badminton')
    expect(getSportByTslCode('BADRAT4')).toBe('badminton')
    expect(getSportByTslCode('VOL')).toBe('volleyball')
    expect(getSportByTslCode('VOLLEYBALL')).toBe('volleyball')
    expect(getSportByTslCode('TEN')).toBe('tennis')
    expect(getSportByTslCode('TENN')).toBe('tennis')
    expect(getSportByTslCode('TE')).toBe('tennis')
    expect(getSportByTslCode('HOCK')).toBeNull()
  })

  it('maps Chinese tournament names to singles disciplines', () => {
    expect(tslDiscipline('badminton', '法國公開賽男子單打')).toBe('MS')
    expect(tslDiscipline('badminton', '法國公開賽女子單打')).toBe('WS')
    expect(tslDiscipline('badminton', '法國公開賽男子雙打')).toBeNull()
    expect(tslDiscipline('tennis', 'ATP 印地安泉大師賽男子單打')).toBe('ATP')
    expect(tslDiscipline('tennis', 'WTA 印第安泉女子單打')).toBe('WTA')
    expect(tslDiscipline('tennis', 'ATP 印地安泉大師賽男子雙打')).toBeNull()
    expect(tslDiscipline('volleyball', '世界男排聯賽')).toBe('M')
    expect(tslDiscipline('volleyball', "Women's Nations League")).toBe('W')
  })
})

describe('台北時間', () => {
  it('把沒有時區的運彩時間當成台北時間，而不是伺服器 UTC', () => {
    const parsed = parseTslDateTime('2026-10-22T18:00:00')
    expect(parsed?.toISOString()).toBe('2026-10-22T10:00:00.000Z')
    expect(taipeiDate(parsed!)).toBe('2026-10-22')
  })

  it('date-only 與 YYYYMMDD 也當成台北曆日', () => {
    expect(parseTslDateTime('20261022')?.toISOString()).toBe('2026-10-21T16:00:00.000Z')
    expect(taipeiDate(parseTslDateTime('2026-10-22')!)).toBe('2026-10-22')
  })

  it('UTC 午夜前後仍對上台北「今天」', () => {
    expect(taipeiDate(new Date('2026-10-21T16:00:00.000Z'))).toBe('2026-10-22')
    expect(taipeiDate(new Date('2026-10-22T15:59:00.000Z'))).toBe('2026-10-22')
    expect(taipeiDate(new Date('2026-10-22T16:00:00.000Z'))).toBe('2026-10-23')
  })

  it('今日清單包含跨午夜的隔日清晨場次', () => {
    expect(belongsOnTaipeiListingDay('2026-10-23T02:00:00+08:00', '2026-10-22')).toBe(true)
    expect(belongsOnTaipeiListingDay('2026-10-23T14:00:00+08:00', '2026-10-22')).toBe(false)
    expect(belongsOnTaipeiListingDay('2026-10-22T18:00:00+08:00', '2026-10-22')).toBe(true)
    expect(addCalendarDays('2026-10-22', 1)).toBe('2026-10-23')
  })

  it('書籤收集視窗包含昨天、今天、明天', () => {
    const now = new Date('2026-10-22T12:00:00+08:00')
    expect(inTaipeiCouponWindow(parseTslDateTime('2026-10-21T22:00:00+08:00')!, now)).toBe(true)
    expect(inTaipeiCouponWindow(parseTslDateTime('2026-10-22T18:00:00+08:00')!, now)).toBe(true)
    expect(inTaipeiCouponWindow(parseTslDateTime('2026-10-23T02:00:00+08:00')!, now)).toBe(true)
    expect(inTaipeiCouponWindow(parseTslDateTime('2026-10-24T12:00:00+08:00')!, now)).toBe(false)
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
      set1: { away: 2.3, home: 1.35 },
      totals: { line: 76.5, over: 1.68, under: 1.75 },
      handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
      correctScore: { '2:0': 4.85, '2:1': 5.65, '1:2': 3.05, '0:2': 1.7 },
      setHandicap: null,
      set1Totals: null,
      set1Handicap: null,
    })
  })

  it('stores handicap rows with the away line', () => {
    const rows = fixtureOddsRows({
      match: null,
      set1: null,
      totals: null,
      handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
      correctScore: null,
      setHandicap: null,
      set1Totals: null,
      set1Handicap: null,
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

  it('沒有英文名時改用中文名，不要整批略過', () => {
    const { fixtures, skipped } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '20261022',
      english: [],
      events: [eventOf()],
    })
    expect(skipped).toEqual([])
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]).toMatchObject({
      awayName: '奈良岡功大',
      homeName: '阿尤什.謝蒂',
      startsAt: '2026-10-22T10:00:00.000Z',
    })
  })

  it('未知運動代碼要列入略過原因，不能默默丟掉', () => {
    const { fixtures, skipped } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '20261022',
      english: [],
      events: [eventOf({ idfosporttype: 'HOCK', tournamentname: '冰球聯賽' })],
    })
    expect(fixtures).toEqual([])
    expect(skipped[0]?.reason).toContain('不支援的運動代碼')
  })

  it('沒有時區的 tsstart 仍寫成台北開賽日', () => {
    const { fixtures } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '20261022',
      english: [{
        idfoevent: '3500893.1',
        participantname_away: 'Naraoka, Kodai',
        participantname_home: 'Shetty, Ayush',
      }],
      events: [eventOf({ tsstart: '2026-10-22T18:00:00' })],
    })
    expect(fixtures[0]?.startsAt).toBe('2026-10-22T10:00:00.000Z')
  })

  it('解析排球 TSL 盤口與運動代碼', () => {
    const { fixtures } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '20261022',
      english: [{
        idfoevent: 'v1',
        participantname_away: 'Italy',
        participantname_home: 'Poland',
      }],
      events: [eventOf({
        idfoevent: 'v1',
        idfosporttype: 'VOL',
        participantname_away: '義大利',
        participantname_home: '波蘭',
        tournamentname: '世界男排聯賽',
        externalreference: 'sr:match:88000001',
        markets: [
          {
            name: '不讓分',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '客勝', hadvalue: 'A', currentpriceup: '1', currentpricedown: '1' },
              { name: '主勝', hadvalue: 'H', currentpriceup: '1', currentpricedown: '1' },
            ],
          },
          {
            name: '[第1盤]不讓分',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '客勝', hadvalue: 'A', currentpriceup: '6', currentpricedown: '5' },
              { name: '主勝', hadvalue: 'H', currentpriceup: '4', currentpricedown: '5' },
            ],
          },
        ],
      })],
    })
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]).toMatchObject({
      sport: 'volleyball',
      discipline: 'M',
      odds: {
        match: { away: 2, home: 2 },
        set1: { away: 2.2, home: 1.8 },
      },
    })
  })
})
