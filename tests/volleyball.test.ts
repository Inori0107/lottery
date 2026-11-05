import { describe, expect, it } from 'vitest'
import {
  setScoreDistribution,
  volleyballMatchDistribution,
  matchProbabilityToPoint,
  matchProbabilityToSet1,
  matchWinProbability,
  probabilityAbove,
  distributionMean,
  coversHandicap,
  fairLine,
} from '../server/models/volleyballRally'
import {
  parseVolleyballSets,
  parseVolleyballCsvRow,
  volleyballDiscipline,
} from '../server/models/volleyballDataset'
import { statshubVolleyballDiscipline } from '../server/models/statshub'
import {
  expectedScore,
  expectedScoreWithFactors,
  effectiveRating,
  updateElo,
  updateEloWithFactors,
  detectHomeAdvantageMode,
  venueModeForQuote,
  VOLLEYBALL_INITIAL_ELO,
  VOLLEYBALL_K_FACTOR,
} from '../server/models/volleyballElo'

describe('排球每球模型', () => {
  describe('setScoreDistribution', () => {
    it('正常局（25分）的分數分布總和為 1', () => {
      const scores = setScoreDistribution(0.5, 0, false)
      const total = scores.reduce((sum, s) => sum + s.probability, 0)
      expect(total).toBeCloseTo(1, 5)
    })

    it('決勝局（15分）的分數分布總和為 1', () => {
      const scores = setScoreDistribution(0.5, 0, true)
      const total = scores.reduce((sum, s) => sum + s.probability, 0)
      expect(total).toBeCloseTo(1, 5)
    })

    it('每球勝率 0.5 時，正常局 A 隊勝率約 0.5', () => {
      const scores = setScoreDistribution(0.5, 0, false)
      const aWins = scores
        .filter(s => s.pointsA > s.pointsB)
        .reduce((sum, s) => sum + s.probability, 0)
      expect(aWins).toBeCloseTo(0.5, 2)
    })

    it('每球勝率較高時，A 隊勝率也較高', () => {
      const scores55 = setScoreDistribution(0.55, 0, false)
      const scores45 = setScoreDistribution(0.45, 0, false)

      const aWins55 = scores55
        .filter(s => s.pointsA > s.pointsB)
        .reduce((sum, s) => sum + s.probability, 0)
      const aWins45 = scores45
        .filter(s => s.pointsA > s.pointsB)
        .reduce((sum, s) => sum + s.probability, 0)

      expect(aWins55).toBeGreaterThan(0.5)
      expect(aWins45).toBeLessThan(0.5)
    })

    it('正常局的最低得分為 25', () => {
      const scores = setScoreDistribution(0.5, 0, false)
      const validScores = scores.filter(s => s.probability > 0.001)
      const minWinnerScore = Math.min(
        ...validScores.map(s => Math.max(s.pointsA, s.pointsB))
      )
      expect(minWinnerScore).toBeGreaterThanOrEqual(25)
    })

    it('決勝局的最低得分為 15', () => {
      const scores = setScoreDistribution(0.5, 0, true)
      const validScores = scores.filter(s => s.probability > 0.001)
      const minWinnerScore = Math.min(
        ...validScores.map(s => Math.max(s.pointsA, s.pointsB))
      )
      expect(minWinnerScore).toBeGreaterThanOrEqual(15)
    })
  })

  describe('volleyballMatchDistribution', () => {
    it('正確比數機率總和為 1', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      const total = Object.values(dist.correctScore).reduce((sum, p) => sum + p, 0)
      expect(total).toBeCloseTo(1, 5)
    })

    it('每球勝率 0.5 時，3:0 和 0:3 機率相近', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      expect(dist.correctScore['3:0']).toBeCloseTo(dist.correctScore['0:3'], 2)
    })

    it('每球勝率 0.5 時，3:1 和 1:3 機率相近', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      expect(dist.correctScore['3:1']).toBeCloseTo(dist.correctScore['1:3'], 2)
    })

    it('每球勝率 0.5 時，3:2 和 2:3 機率相近', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      expect(dist.correctScore['3:2']).toBeCloseTo(dist.correctScore['2:3'], 2)
    })

    it('每球勝率較高時，A 隊獲勝（3:0, 3:1, 3:2）機率較高', () => {
      const dist55 = volleyballMatchDistribution(0.55, 0.1)
      const dist45 = volleyballMatchDistribution(0.45, 0.1)

      const aWins55 = dist55.correctScore['3:0'] + dist55.correctScore['3:1'] + dist55.correctScore['3:2']
      const aWins45 = dist45.correctScore['3:0'] + dist45.correctScore['3:1'] + dist45.correctScore['3:2']

      expect(aWins55).toBeGreaterThan(aWins45)
    })

    it('總分分布的平均值在合理範圍', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      const mean = distributionMean(dist.total)
      expect(mean).toBeGreaterThan(150)
      expect(mean).toBeLessThan(250)
    })

    it('第一盤分布存在', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      expect(dist.set1Total.values.length).toBeGreaterThan(0)
      expect(dist.set1Margin.values.length).toBeGreaterThan(0)
    })

    it('局數盤差由正確比數推出', () => {
      const dist = volleyballMatchDistribution(0.5, 0)
      expect(distributionMean(dist.setMargin)).toBeCloseTo(0, 1)
    })

    it('把勝場率反推成每球勝率後能回到接近的勝場率', () => {
      const pMatch = 0.72
      const rally = matchProbabilityToPoint(pMatch)
      expect(matchWinProbability(rally)).toBeCloseTo(pMatch, 2)
      expect(matchProbabilityToSet1(pMatch)).toBeGreaterThan(0.5)
      expect(matchProbabilityToSet1(pMatch)).toBeLessThan(pMatch)
    })
  })

  describe('分布計算函數', () => {
    it('probabilityAbove 計算正確', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      const pAbove200 = probabilityAbove(dist.total, 200)
      expect(pAbove200).toBeGreaterThan(0)
      expect(pAbove200).toBeLessThan(1)
    })

    it('coversHandicap 計算正確', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      const pCovers0 = coversHandicap(dist.margin, 0)
      expect(pCovers0).toBeCloseTo(0.5, 1)
    })

    it('fairLine 返回合理值', () => {
      const dist = volleyballMatchDistribution(0.5, 0.1)
      const fair = fairLine(dist.total)
      expect(fair).toBeGreaterThan(150)
      expect(fair).toBeLessThan(250)
    })
  })
})

describe('排球資料集', () => {
  describe('parseVolleyballSets', () => {
    it('解析正常的 3:0 比數', () => {
      const sets = parseVolleyballSets('25-20 25-22 25-18', false)
      expect(sets).toHaveLength(3)
      expect(sets![0]).toEqual({ pointsA: 25, pointsB: 20, sideAWon: true, isLegal: true })
    })

    it('解析正常的 3:2 比數（含決勝局）', () => {
      const sets = parseVolleyballSets('25-20 20-25 25-22 22-25 15-12', false)
      expect(sets).toHaveLength(5)
      expect(sets![4]).toEqual({ pointsA: 15, pointsB: 12, sideAWon: true, isLegal: true })
    })

    it('解析延長決勝局', () => {
      const sets = parseVolleyballSets('25-20 20-25 25-22 22-25 17-15', false)
      expect(sets).toHaveLength(5)
      expect(sets![4]!.isLegal).toBe(true)
    })

    it('swap 參數正確交換得分', () => {
      const sets = parseVolleyballSets('25-20 25-22 25-18', true)
      expect(sets![0]).toEqual({ pointsA: 20, pointsB: 25, sideAWon: false, isLegal: true })
    })

    it('拒絕不完整的比分', () => {
      expect(parseVolleyballSets('25-20', false)).toBeNull()
      expect(parseVolleyballSets('25-20 25-22', false)).toBeNull()
    })

    it('拒絕超過 5 局的比分', () => {
      expect(parseVolleyballSets('25-20 25-22 25-18 25-20 15-10 15-10', false)).toBeNull()
    })
  })

  describe('parseVolleyballCsvRow', () => {
    it('解析有效的比賽資料', () => {
      const result = parseVolleyballCsvRow({
        date: '2026-01-15',
        discipline: 'M',
        tournament: 'Test League',
        tier: 'League',
        round: 'Round 1',
        team1: 'Team A',
        team2: 'Team B',
        winner: '1',
        score: '25-20 25-22 25-18',
      })

      expect('match' in result).toBe(true)
      if ('match' in result) {
        expect(result.match.discipline).toBe('M')
        expect(result.match.sets).toHaveLength(3)
        expect(result.match.matchLegal).toBe(true)
      }
    })

    it('拒絕超出範圍的日期', () => {
      const result = parseVolleyballCsvRow({
        date: '2027-02-01',
        discipline: 'M',
        tournament: 'Test',
        team1: 'A',
        team2: 'B',
        winner: '1',
        score: '25-20 25-22 25-18',
      })
      expect('reason' in result).toBe(true)
      if ('reason' in result) {
        expect(result.reason).toBe('out_of_range')
      }
    })

    it('拒絕無效的項目', () => {
      const result = parseVolleyballCsvRow({
        date: '2026-01-15',
        discipline: 'X',
        tournament: 'Test',
        team1: 'A',
        team2: 'B',
        winner: '1',
        score: '25-20 25-22 25-18',
      })
      expect('reason' in result).toBe(true)
      if ('reason' in result) {
        expect(result.reason).toBe('bad_discipline')
      }
    })

    it('正確處理主場資訊', () => {
      const result = parseVolleyballCsvRow({
        date: '2026-01-15',
        discipline: 'M',
        tournament: 'Test',
        team1: 'Team A',
        team2: 'Team B',
        winner: '1',
        score: '25-20 25-22 25-18',
        team1_home: '1',
      })

      if ('match' in result) {
        const sideAIsTeam1 = result.match.sideAId < result.match.sideBId
        expect(result.match.sideAIsHome).toBe(sideAIsTeam1)
      }
    })
  })

  describe('volleyballDiscipline', () => {
    it('辨識男排', () => {
      expect(volleyballDiscipline('男子排球聯賽')).toBe('M')
      expect(volleyballDiscipline("Men's Volleyball")).toBe('M')
    })

    it('辨識女排', () => {
      expect(volleyballDiscipline('女子排球聯賽')).toBe('W')
      expect(volleyballDiscipline("Women's Volleyball")).toBe('W')
    })

    it('無法辨識時返回 null', () => {
    expect(volleyballDiscipline('排球')).toBeNull()
    expect(volleyballDiscipline('Volleyball')).toBeNull()
    expect(statshubVolleyballDiscipline('Superliga | Brazil')).toBe('M')
    expect(statshubVolleyballDiscipline('Superliga, Women | Brazil')).toBe('W')
    })
  })
})

describe('排球 Elo 模型', () => {
  it('1500 對 1500，A 勝後變成 1516 與 1484', () => {
    const next = updateElo(1500, 1500, true)
    expect(next.expectedA).toBe(0.5)
    expect(next.ratingA).toBe(1500 + VOLLEYBALL_K_FACTOR * 0.5)
    expect(next.ratingB).toBe(1500 - VOLLEYBALL_K_FACTOR * 0.5)
  })

  it('平手起點的期望值是 0.5', () => {
    expect(expectedScore(VOLLEYBALL_INITIAL_ELO, VOLLEYBALL_INITIAL_ELO)).toBe(0.5)
  })

  it('主場優勢增加勝率', () => {
    const neutral = expectedScoreWithFactors(1500, 1500, false, 'neutral', 1.0, 1.0)
    const home = expectedScoreWithFactors(1500, 1500, true, 'club', 1.0, 1.0)
    expect(home).toBeGreaterThan(neutral)
  })

  it('報價語意：主隊為地主時，客隊 sideA 不該拿到主場加分', () => {
    const pAway = expectedScoreWithFactors(1500, 1500, false, 'club', 1, 1)
    expect(pAway).toBeLessThan(0.5)
    expect(detectHomeAdvantageMode('VNL Men')).toBe('neutral')
    expect(detectHomeAdvantageMode('TVL 2026')).toBe('club')
    expect(venueModeForQuote(true, 'VNL 2026')).toBe('neutral')
    expect(venueModeForQuote(true, '')).toBe('club')
    expect(venueModeForQuote(false, 'TVL 2026')).toBe('neutral')
  })

  it('更新 Elo 時要用含主場的期望勝率，避免主場被烤進評分', () => {
    const withFactors = updateEloWithFactors(1500, 1500, true, false, 'club', 1, 1)
    const raw = updateElo(1500, 1500, true)
    expect(withFactors.expectedA).toBeLessThan(0.5)
    expect(withFactors.ratingA - 1500).toBeGreaterThan(raw.ratingA - 1500)
  })

  it('陣容強度影響勝率', () => {
    const full = expectedScoreWithFactors(1500, 1500, false, 'neutral', 1.0, 1.0)
    const weak = expectedScoreWithFactors(1500, 1500, false, 'neutral', 0.9, 1.0)
    const strong = expectedScoreWithFactors(1500, 1500, false, 'neutral', 1.1, 1.0)
    expect(strong).toBeGreaterThan(full)
    expect(full).toBeGreaterThan(weak)
  })

  it('停賽把分數拉回 1500', () => {
    const active = effectiveRating(1800, 100, '2024-07-01', '2024-07-01', 'inactivity')
    const idle = effectiveRating(1800, 100, '2024-01-01', '2024-07-01', 'inactivity')
    expect(idle).toBeGreaterThan(VOLLEYBALL_INITIAL_ELO)
    expect(idle).toBeLessThan(active)
  })
})
