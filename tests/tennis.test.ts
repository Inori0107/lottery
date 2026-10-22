import { describe, expect, it } from 'vitest'
import {
  coversHandicap,
  distributionMean,
  fairLine,
  gameWinProbability,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  matchWinProbability,
  setScoreOutcomes,
  tennisMatchDistribution,
  tiebreakWinProbability,
} from '../server/models/tennisRally'
import {
  parseTennisCsvRow,
  parseTennisSets,
  reverseTennisSetScore,
  tennisDiscipline,
} from '../server/models/tennisDataset'
import { runTennisDiscipline } from '../server/models/tennisBacktest'
import { expectedScore, expectedScoreWithSurface, updateElo, K_FACTOR, INITIAL_ELO } from '../server/models/tennisElo'
import { resolveTennisPlayerId, buildTennisAliasIndex, toTslPlayerName } from '../server/models/tennisNames'
import { tslDiscipline, parseTslPayload } from '../server/models/tsl'
import { tennisBestOf } from '../shared/sports'

describe('網球每分模型', () => {
  it('每分勝率 0.5 時，每局勝率約 0.5', () => {
    expect(gameWinProbability(0.5)).toBeCloseTo(0.5, 5)
  })

  it('每分勝率較高時，搶七勝率也較高', () => {
    expect(tiebreakWinProbability(0.55)).toBeGreaterThan(0.5)
    expect(tiebreakWinProbability(0.45)).toBeLessThan(0.5)
  })

  it('盤分分布總和為 1，且 0.5 時雙方勝率接近', () => {
    const scores = setScoreOutcomes(0.5, 0.5)
    const total = scores.reduce((sum, score) => sum + score.probability, 0)
    const aWins = scores.filter(score => score.aWon).reduce((sum, score) => sum + score.probability, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(aWins).toBeCloseTo(0.5, 2)
  })

  it('三盤兩勝正確比數總和為 1', () => {
    const dist = tennisMatchDistribution(0.5, 0)
    const total = Object.values(dist.correctScore).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(dist.correctScore['2:0']).toBeCloseTo(dist.correctScore['0:2']!, 2)
  })

  it('五盤三勝正確比數總和為 1', () => {
    const dist = tennisMatchDistribution(0.5, 0, 5)
    const total = Object.values(dist.correctScore).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(dist.correctScore['3:0']).toBeCloseTo(dist.correctScore['0:3']!, 2)
  })

  it('總局數平均值在合理範圍', () => {
    const dist = tennisMatchDistribution(0.5, 0.08)
    const mean = distributionMean(dist.total)
    expect(mean).toBeGreaterThan(16)
    expect(mean).toBeLessThan(32)
  })

  it('讓局 0 時覆蓋率接近 0.5', () => {
    const dist = tennisMatchDistribution(0.5, 0)
    expect(coversHandicap(dist.margin, 0)).toBeCloseTo(0.5, 1)
  })

  it('fairLine 落在合理總局數', () => {
    const dist = tennisMatchDistribution(0.5, 0)
    const line = fairLine(dist.total)
    expect(line).toBeGreaterThan(16)
    expect(line).toBeLessThan(32)
  })

  it('全場熱門的第一盤勝率低於全場', () => {
    const set1 = matchProbabilityToSet1(0.8, 3)
    expect(set1).toBeGreaterThan(0.5)
    expect(set1).toBeLessThan(0.8)
  })

  it('可由全場勝率反推每分勝率', () => {
    const point = matchProbabilityToPoint(0.8, 3)
    expect(matchWinProbability(point, 3)).toBeCloseTo(0.8, 2)
  })
})

describe('網球資料集', () => {
  it('解析 2:0 與搶七', () => {
    const sets = parseTennisSets('6-4 7-6(5)', false)
    expect(sets).toHaveLength(2)
    expect(sets![1]).toMatchObject({ gamesA: 7, gamesB: 6, isTiebreak: true, isLegal: true })
  })

  it('解析 2:1 含交換', () => {
    const sets = parseTennisSets('6-4 3-6 6-3', true)
    expect(sets![0]).toMatchObject({ gamesA: 4, gamesB: 6, sideAWon: false })
  })

  it('拒絕 walkover', () => {
    expect(parseTennisSets('W/O', false)).toBeNull()
  })

  it('反轉搶七局分不會弄壞括號', () => {
    expect(reverseTennisSetScore('7-6(5)')).toBe('6-7(5)')
    expect(reverseTennisSetScore('6-4')).toBe('4-6')
  })

  it('CSV 解析有效比賽', () => {
    const result = parseTennisCsvRow({
      date: '2025-06-01',
      discipline: 'ATP',
      tournament: 'ATP 500 Halle',
      player1: 'Jannik Sinner',
      player2: 'Carlos Alcaraz',
      winner: '1',
      score: '6-4 6-4',
      surface: 'grass',
    })
    expect('match' in result).toBe(true)
    if ('match' in result) {
      expect(result.match.discipline).toBe('ATP')
      expect(result.match.surface).toBe('grass')
      expect(result.match.sideAName.includes('Alcaraz') || result.match.sideBName.includes('Alcaraz')).toBe(true)
    }
  })

  it('女子優先於男子（women 含 men）', () => {
    expect(tennisDiscipline('WTA 1000 女子單打')).toBe('WTA')
    expect(tennisDiscipline("Women's singles")).toBe('WTA')
    expect(tennisDiscipline('ATP 男子單打')).toBe('ATP')
    expect(tennisDiscipline('ATP 男子雙打')).toBeNull()
  })
})

describe('網球 Elo 與名稱', () => {
  it('1500 對 1500 勝後變成 1516', () => {
    const next = updateElo(1500, 1500, true)
    expect(next.expectedA).toBe(0.5)
    expect(next.ratingA).toBe(1500 + K_FACTOR * 0.5)
  })

  it('場地偏好會移動勝率', () => {
    const clayLove = { hard: 1, clay: 1.2, grass: 0.9, carpet: 1 }
    const clayHate = { hard: 1, clay: 0.8, grass: 1.1, carpet: 1 }
    const onClay = expectedScoreWithSurface(1500, 1500, 'clay', clayLove, clayHate)
    expect(onClay).toBeGreaterThan(expectedScore(INITIAL_ELO, INITIAL_ELO))
  })

  it('TSL 與自然語序可對上同一選手', () => {
    const index = buildTennisAliasIndex([{ id: 'nole', name: 'Djokovic, Novak' }])
    expect(resolveTennisPlayerId(['Novak Djokovic'], index)).toBe('nole')
    expect(resolveTennisPlayerId(['喬科維奇'], index)).toBe('nole')
    expect(toTslPlayerName('Carlos Alcaraz')).toBe('Alcaraz, Carlos')
  })
})

describe('網球運彩盤口', () => {
  it('大滿貫男單為五盤三勝', () => {
    expect(tennisBestOf('ATP', '溫網男子單打')).toBe(5)
    expect(tennisBestOf('WTA', '溫網女子單打')).toBe(3)
    expect(tennisBestOf('ATP', 'ATP 500 北京')).toBe(3)
  })

  it('解析網球 TSL 市場名稱', () => {
    const { fixtures } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '2026-10-22',
      english: [{
        idfoevent: 't1',
        participantname_away: 'Sinner, Jannik',
        participantname_home: 'Alcaraz, Carlos',
      }],
      events: [{
        idfoevent: 't1',
        idfosporttype: 'TEN',
        participantname_away: '辛納',
        participantname_home: '阿爾卡拉斯',
        tsstart: '2026-10-22T10:00:00.000Z',
        tournamentname: 'ATP 500 北京男子單打',
        externalreference: 'sr:match:90000001',
        markets: [
          {
            name: '不讓分',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '客勝', hadvalue: 'A', currentpriceup: '6', currentpricedown: '5' },
              { name: '主勝', hadvalue: 'H', currentpriceup: '4', currentpricedown: '5' },
            ],
          },
          {
            name: '[第1盤]不讓分',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '客勝', hadvalue: 'A', currentpriceup: '1', currentpricedown: '1' },
              { name: '主勝', hadvalue: 'H', currentpriceup: '1', currentpricedown: '1' },
            ],
          },
          {
            name: '[總局數]大小 21.5',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '大 21.5', currentpriceup: '9', currentpricedown: '10', currenthandicap: '21.5' },
              { name: '小 21.5', currentpriceup: '9', currentpricedown: '10', currenthandicap: '21.5' },
            ],
          },
          {
            name: '盤數讓分 -1.5',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '客 +1.5', hadvalue: 'A', currentpriceup: '5', currentpricedown: '4' },
              { name: '主 -1.5', hadvalue: 'H', currentpriceup: '4', currentpricedown: '5' },
            ],
          },
          {
            name: '正確比數',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '2:0', currentpriceup: '2', currentpricedown: '1' },
              { name: '2:1', currentpriceup: '3', currentpricedown: '1' },
              { name: '1:2', currentpriceup: '4', currentpricedown: '1' },
              { name: '0:2', currentpriceup: '5', currentpricedown: '1' },
            ],
          },
          {
            name: '[單盤-總局數]大小 9.5',
            istradable: true,
            ismainline: true,
            selections: [
              { name: '大 9.5', currentpriceup: '1', currentpricedown: '1', currenthandicap: '9.5' },
              { name: '小 9.5', currentpriceup: '1', currentpricedown: '1', currenthandicap: '9.5' },
            ],
          },
        ],
      }],
    })
    expect(tslDiscipline('tennis', 'ATP 500 北京男子單打')).toBe('ATP')
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]?.odds.match).toEqual({ away: 2.2, home: 1.8 })
    expect(fixtures[0]?.odds.set1).toEqual({ away: 2, home: 2 })
    expect(fixtures[0]?.odds.totals).toEqual({ line: 21.5, over: 1.9, under: 1.9 })
    expect(fixtures[0]?.odds.setHandicap).toEqual({ homeLine: -1.5, away: 2.25, home: 1.8 })
    expect(fixtures[0]?.odds.correctScore).toEqual({ '2:0': 3, '2:1': 4, '1:2': 5, '0:2': 6 })
    expect(fixtures[0]?.odds.set1Totals).toEqual({ line: 9.5, over: 2, under: 2 })
  })

  it('辨識 TENN 運動代碼', () => {
    const { fixtures } = parseTslPayload({
      capturedAt: '2026-10-22T00:00:00.000Z',
      date: '2026-10-22',
      english: [{
        idfoevent: 't2',
        participantname_away: 'Swiatek, Iga',
        participantname_home: 'Sabalenka, Aryna',
      }],
      events: [{
        idfoevent: 't2',
        idfosporttype: 'TENN',
        participantname_away: '斯威雅蒂',
        participantname_home: '薩巴倫卡',
        tsstart: '2026-10-22T12:00:00.000Z',
        tournamentname: 'WTA 1000 北京女子單打',
        externalreference: 'sr:match:90000002',
        markets: [{
          name: '不讓分',
          istradable: true,
          ismainline: true,
          selections: [
            { name: '客勝', hadvalue: 'A', currentpriceup: '1', currentpricedown: '1' },
            { name: '主勝', hadvalue: 'H', currentpriceup: '1', currentpricedown: '1' },
          ],
        }],
      }],
    })
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]?.discipline).toBe('WTA')
  })
})

describe('網球回測', () => {
  it('能從少量比賽產出評分與模型', () => {
    const result = runTennisDiscipline('ATP', [
      {
        matchId: 'a',
        discipline: 'ATP',
        playedOn: '2025-01-01',
        sideAId: 'p1',
        sideBId: 'p2',
        surface: 'hard',
        includeMatch: true,
        includeSet1: true,
        sideAWonMatch: true,
        sideAWonSet1: true,
        sets: [
          { gamesA: 6, gamesB: 4, sideAWon: true, isTiebreak: false, isLegal: true },
          { gamesA: 6, gamesB: 3, sideAWon: true, isTiebreak: false, isLegal: true },
        ],
      },
      {
        matchId: 'b',
        discipline: 'ATP',
        playedOn: '2025-06-01',
        sideAId: 'p1',
        sideBId: 'p2',
        surface: 'clay',
        includeMatch: true,
        includeSet1: true,
        sideAWonMatch: false,
        sideAWonSet1: false,
        sets: [
          { gamesA: 4, gamesB: 6, sideAWon: false, isTiebreak: false, isLegal: true },
          { gamesA: 3, gamesB: 6, sideAWon: false, isTiebreak: false, isLegal: true },
        ],
      },
      {
        matchId: 'c',
        discipline: 'ATP',
        playedOn: '2026-01-01',
        sideAId: 'p1',
        sideBId: 'p2',
        surface: 'hard',
        includeMatch: true,
        includeSet1: true,
        sideAWonMatch: true,
        sideAWonSet1: true,
        sets: [
          { gamesA: 7, gamesB: 6, sideAWon: true, isTiebreak: true, isLegal: true },
          { gamesA: 6, gamesB: 4, sideAWon: true, isTiebreak: false, isLegal: true },
        ],
      },
    ])
    expect(result.ratings).toHaveLength(2)
    expect(result.payload.rally).toBeTruthy()
    expect(result.modelVersion).toContain('tennis-elo')
  })
})
