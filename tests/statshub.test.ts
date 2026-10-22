import { describe, expect, it } from 'vitest'
import { parseCsvRow } from '../server/models/dataset'
import {
  linkStatshubName,
  parseStatshubPage,
  resolveStatshubPlayer,
  statshubDisplayName,
  statshubMatchesToCsv,
  type StatshubMatch,
} from '../server/models/statshub'
import { buildPlayerDirectory } from '../server/models/sun'

const encodeTurboStream = (root: unknown) => {
  const values: unknown[] = []
  const add = (value: unknown): number => {
    if (value === null) return -5
    if (value === undefined) return -7
    const index = values.length
    values.push(undefined)
    if (Array.isArray(value)) {
      values[index] = value.map(add)
    } else if (typeof value === 'object') {
      const record: Record<string, number> = {}
      for (const [key, item] of Object.entries(value)) record[`_${add(key)}`] = add(item)
      values[index] = record
    } else {
      values[index] = value
    }
    return index
  }
  add(root)
  return `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(`${JSON.stringify(values)}\n`)});</script>`
}

const rawMatch = (overrides: Record<string, unknown> = {}) => ({
  _id: 1,
  match_start: Date.UTC(2026, 9, 21, 9, 30) / 1000,
  match_status: 'post',
  status: { _id: 100, name: 'Ended' },
  periods: { ft: { home: 0, away: 2 }, p2: { home: 7, away: 21 }, p1: { home: 17, away: 21 } },
  result: { home: 0, away: 2, winner: 'away' },
  teams: {
    home: { uid: 322337, name: 'Merkle, Arnaud' },
    away: { uid: 402997, name: 'Popov, Ch.' },
  },
  __roundName: { name: 'R32' },
  ...overrides,
})

const pageHtml = (tournaments: Array<{ name: string, matches: unknown[] }> | null) => encodeTurboStream({
  loaderData: {
    'routes/_sh.sport.$sportId/index': {
      matchList: { data: tournaments ? { matchList: { tournaments } } : undefined, sportId: 31 },
      validDates: { data: { validCalendarDates: ['2026-10-20', '2026-10-21'] } },
    },
  },
})

describe('Sportradar 賽程頁解析', () => {
  it('解出單打賽果，並把局分依局序組成字串', () => {
    const page = parseStatshubPage(pageHtml([
      { name: 'French Open, MS', matches: [rawMatch()] },
      { name: 'French Open, MD', matches: [rawMatch({ _id: 2 })] },
      { name: 'Czech Open, WS, Qualifying', matches: [rawMatch({ _id: 3, __roundName: { name: '1/16' } })] },
    ]))

    expect(page.validDates).toEqual(['2026-10-20', '2026-10-21'])
    expect(page.matches).toHaveLength(2)
    expect(page.matches[0]).toMatchObject({
      sportradarId: 1,
      playedOn: '2026-10-21',
      discipline: 'MS',
      tournament: 'French Open 2026',
      round: 'R32',
      played: true,
      winner: '2',
      score: '17-21 7-21',
    })
    expect(page.matches[1]).toMatchObject({ discipline: 'WS', round: 'Q R32' })
  })

  it('沒有比賽的日期回傳空清單，進行中的比賽會被標出', () => {
    expect(parseStatshubPage(pageHtml(null)).matches).toEqual([])
    const live = parseStatshubPage(pageHtml([{ name: 'French Open, WS', matches: [rawMatch({ match_status: 'live' })] }]))
    expect(live.hasLiveMatch).toBe(true)
    expect(live.matches[0]?.played).toBe(false)
  })

  it('未開賽、棄權場次分別標成 pre 與 abandoned，並保留各局比分', () => {
    const page = parseStatshubPage(pageHtml([{
      name: 'French Open, MS',
      matches: [
        rawMatch({ _id: 7, match_status: 'pre', status: { _id: 0, name: 'Not started' }, periods: null, result: null }),
        rawMatch({ _id: 8, status: { _id: 93, name: 'Walkover' } }),
        rawMatch({ _id: 9 }),
      ],
    }]))
    const byId = new Map(page.matches.map(match => [match.sportradarId, match]))
    expect(byId.get(7)).toMatchObject({ status: 'pre', played: false, games: [] })
    expect(byId.get(8)).toMatchObject({ status: 'abandoned', played: false })
    expect(byId.get(9)).toMatchObject({
      status: 'ended',
      startsAt: '2026-10-21T09:30:00.000Z',
      games: [{ home: 17, away: 21 }, { home: 7, away: 21 }],
    })
  })

  it('找不到內嵌資料時拋出錯誤', () => {
    expect(() => parseStatshubPage('<html>Access Denied</html>')).toThrow()
  })
})

describe('Sportradar 選手對應', () => {
  const directory = buildPlayerDirectory([
    { id: '10', name: 'LEE Cheuk Yiu' },
    { id: '11', name: 'LIN Chun Yi' },
    { id: '12', name: 'LI Shi Feng' },
    { id: '13', name: 'LI Shu Fang' },
    { id: '14', name: 'Viktor AXELSEN' },
  ])

  it('把「姓, 名」轉成既有的「名 姓氏大寫」格式', () => {
    expect(statshubDisplayName('Merkle, Arnaud')).toBe('Arnaud MERKLE')
    expect(statshubDisplayName('Lin, C.-Y.')).toBe('C.-Y. LIN')
    expect(statshubDisplayName('Sufryd')).toBe('Sufryd')
  })

  it('完整姓名不論順序都能對上', () => {
    expect(linkStatshubName('Lee, Cheuk Yiu', directory)).toBe('10')
    expect(linkStatshubName('Axelsen, Viktor', directory)).toBe('14')
  })

  it('縮寫只在姓氏加縮寫唯一時才對上', () => {
    expect(linkStatshubName('Lin, C.-Y.', directory)).toBe('11')
    expect(linkStatshubName('Li, S. F.', directory)).toBeUndefined()
  })

  it('完整姓名不同時不改用縮寫硬配', () => {
    expect(linkStatshubName('Lin, Chen Yu', directory)).toBeUndefined()
  })

  it('既有名字是縮寫、Sportradar 是全名時，用姓氏加縮寫對上', () => {
    const abbreviated = buildPlayerDirectory([
      { id: '20', name: 'PUSARLA V. Sindhu' },
      { id: '21', name: 'PRANNOY H. S.' },
    ])
    expect(linkStatshubName('Pusarla, Venkata Sindhu', abbreviated)).toBe('20')
    expect(linkStatshubName('Prannoy, H. S.', abbreviated)).toBe('21')
    const conflicting = buildPlayerDirectory([
      { id: '20', name: 'PUSARLA V. Sindhu' },
      { id: '22', name: 'PUSARLA Vijaya Sri' },
    ])
    expect(linkStatshubName('Pusarla, Venkata Sindhu', conflicting)).toBeUndefined()
  })

  it('北歐字母依常見轉寫比對', () => {
    const nordic = buildPlayerDirectory([{ id: '30', name: 'Alexander RINGBÆK' }])
    expect(linkStatshubName('Ringbaek, Alexander', nordic)).toBe('30')
  })

  it('只有一個名字時，用姓氏加第一個名字在唯一時對上', () => {
    const ginting = buildPlayerDirectory([{ id: '40', name: 'Anthony Sinisuka GINTING' }])
    expect(linkStatshubName('Ginting, Anthony', ginting)).toBe('40')
    const twoAnthonys = buildPlayerDirectory([
      { id: '40', name: 'Anthony Sinisuka GINTING' },
      { id: '41', name: 'Anthony Putra GINTING' },
    ])
    expect(linkStatshubName('Ginting, Anthony', twoAnthonys)).toBeUndefined()
  })

  it('名字對不上時，退回已存在的 sportradar:<uid>', () => {
    const empty = buildPlayerDirectory([])
    expect(resolveStatshubPlayer(['Popov, Ch.'], 2, empty, new Set(['sportradar:2']))).toBe('sportradar:2')
    expect(resolveStatshubPlayer(['Popov, Ch.'], 3, empty, new Set(['sportradar:2']))).toBeUndefined()
    expect(resolveStatshubPlayer(['Popov, Ch.'], null, empty, new Set())).toBeUndefined()
  })
})

describe('Sportradar 轉成賽果列', () => {
  const baseMatch: StatshubMatch = {
    sportradarId: 1,
    playedOn: '2026-10-21',
    startsAt: '2026-10-21T09:30:00.000Z',
    discipline: 'MS',
    tournament: 'French Open 2026',
    round: 'R32',
    status: 'ended',
    played: true,
    live: false,
    home: { uid: 1, name: 'Lee, Cheuk Yiu' },
    away: { uid: 2, name: 'Popov, Ch.' },
    winner: '2',
    score: '17-21 7-21',
    games: [{ home: 17, away: 21 }, { home: 7, away: 21 }],
  }
  const directories = {
    MS: buildPlayerDirectory([{ id: '10', name: 'LEE Cheuk Yiu' }]),
    WS: buildPlayerDirectory([]),
  }

  it('對不上的選手以 Sportradar uid 建成新選手，並略過重複與未完賽場次', () => {
    const converted = statshubMatchesToCsv([
      baseMatch,
      baseMatch,
      { ...baseMatch, sportradarId: 2, played: false, score: '' },
    ], directories)

    expect(converted.rows).toHaveLength(1)
    expect(converted.skippedScoring).toBe(1)
    expect(converted.linkedPlayers).toBe(1)
    expect(converted.newPlayers).toEqual([{ discipline: 'MS', playerId: 'sportradar:2', name: 'Ch. POPOV' }])
    expect(converted.rows[0]).toMatchObject({
      team1: 'Cheuk Yiu LEE [10]',
      team2: 'Ch. POPOV [sportradar:2]',
      winner: '2',
      score: '17-21 7-21',
    })
  })

  it('轉出的列可以直接用既有規則匯入', () => {
    const [row] = statshubMatchesToCsv([baseMatch], directories).rows
    const parsed = parseCsvRow(row ?? {})
    expect('match' in parsed).toBe(true)
    if (!('match' in parsed)) return
    expect(parsed.match.matchLegal).toBe(true)
    expect(parsed.match.sourceTeam1Id).toBe('10')
    expect(parsed.match.sourceTeam2Id).toBe('sportradar:2')
  })
})
