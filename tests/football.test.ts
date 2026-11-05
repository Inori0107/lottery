import { describe, expect, it } from 'vitest'
import {
  computeScoreDistribution,
  totalGoalsProbability,
  handicapProbability,
  correctScoreProbability,
  expectedGoalsFromElo,
  eloTo1X2,
  impliedProbabilitiesFrom1X2Odds,
  firstHalfScoreDistribution,
} from '../server/models/footballGoals'
import {
  parseFootballScore,
  parseFootballCsvRow,
  footballDiscipline,
} from '../server/models/footballDataset'
import {
  expectedScore,
  expectedScoreWithFactors,
  effectiveRating,
  updateElo,
  detectHomeAdvantageMode,
  venueModeForQuote,
  FOOTBALL_INITIAL_ELO,
  FOOTBALL_K_FACTOR,
} from '../server/models/footballElo'
import { settleFootballBet, type FootballScore } from '../server/models/settle'
import { classifyTslMarket } from '../server/models/tsl'

describe('足球進球模型', () => {
  describe('computeScoreDistribution', () => {
    it('比分機率總和為 1', () => {
      const dist = computeScoreDistribution(1.5, 1.2)
      let total = 0
      for (const prob of dist.scores.values()) total += prob
      expect(total).toBeCloseTo(1, 5)
    })

    it('1X2 機率總和為 1', () => {
      const dist = computeScoreDistribution(1.5, 1.2)
      expect(dist.homeWin + dist.draw + dist.awayWin).toBeCloseTo(1, 5)
    })

    it('高進球期望時，主勝機率較高', () => {
      const dist = computeScoreDistribution(2.0, 1.0)
      expect(dist.homeWin).toBeGreaterThan(dist.awayWin)
    })

    it('相同進球期望時，和局機率合理', () => {
      const dist = computeScoreDistribution(1.3, 1.3)
      expect(dist.draw).toBeGreaterThan(0.2)
      expect(dist.draw).toBeLessThan(0.4)
    })

    it('Dixon-Coles 調整使 0-0 機率更高', () => {
      const withRho = computeScoreDistribution(1.0, 1.0, -0.13)
      const noRho = computeScoreDistribution(1.0, 1.0, 0)
      const prob00WithRho = withRho.scores.get('0:0') ?? 0
      const prob00NoRho = noRho.scores.get('0:0') ?? 0
      expect(prob00WithRho).toBeGreaterThan(prob00NoRho)
    })
  })

  describe('totalGoalsProbability', () => {
    it('大 2.5 和小 2.5 機率總和為 1', () => {
      const dist = computeScoreDistribution(1.3, 1.2)
      const over = totalGoalsProbability(dist, 2.5, true)
      const under = totalGoalsProbability(dist, 2.5, false)
      expect(over + under).toBeCloseTo(1, 5)
    })

    it('進球期望越高，大球機率越高', () => {
      const low = computeScoreDistribution(1.0, 1.0)
      const high = computeScoreDistribution(2.0, 2.0)
      const overLow = totalGoalsProbability(low, 2.5, true)
      const overHigh = totalGoalsProbability(high, 2.5, true)
      expect(overHigh).toBeGreaterThan(overLow)
    })
  })

  describe('handicapProbability', () => {
    it('主讓 -0.5 時，機率總和為 1', () => {
      const dist = computeScoreDistribution(1.5, 1.2)
      const homeCovers = handicapProbability(dist, -0.5, true)
      const awayCovers = handicapProbability(dist, -0.5, false)
      expect(homeCovers + awayCovers).toBeCloseTo(1, 5)
    })

    it('強隊讓分時，仍有勝率優勢', () => {
      const dist = computeScoreDistribution(2.0, 1.0)
      const homeCovers = handicapProbability(dist, -0.5, true)
      expect(homeCovers).toBeGreaterThan(0.5)
    })
  })

  describe('expectedGoalsFromElo', () => {
    it('相同 Elo 時，主場有進球優勢', () => {
      const neutral = expectedGoalsFromElo(1500, 1500, false)
      const home = expectedGoalsFromElo(1500, 1500, true)
      expect(home.lambdaHome).toBeGreaterThan(neutral.lambdaHome)
    })

    it('高 Elo 球隊有更高進球期望', () => {
      const { lambdaHome, lambdaAway } = expectedGoalsFromElo(1600, 1400, true)
      expect(lambdaHome).toBeGreaterThan(lambdaAway)
    })
  })

  describe('eloTo1X2', () => {
    it('相同 Elo 且主場時，主勝機率略高', () => {
      const probs = eloTo1X2(1500, 1500, true)
      expect(probs.home).toBeGreaterThan(probs.away)
    })

    it('機率總和為 1', () => {
      const probs = eloTo1X2(1550, 1450, true)
      expect(probs.home + probs.draw + probs.away).toBeCloseTo(1, 5)
    })
  })

  describe('impliedProbabilitiesFrom1X2Odds', () => {
    it('去水後機率總和為 1', () => {
      const implied = impliedProbabilitiesFrom1X2Odds(2.1, 3.4, 3.5)
      expect(implied.home + implied.draw + implied.away).toBeCloseTo(1, 5)
    })

    it('vig 計算正確', () => {
      const implied = impliedProbabilitiesFrom1X2Odds(2.0, 3.0, 4.0)
      expect(implied.vig).toBeGreaterThan(0)
    })
  })

  describe('firstHalfScoreDistribution', () => {
    it('上半場進球期望約為全場的 45%', () => {
      const fullTime = computeScoreDistribution(1.5, 1.2)
      const halfTime = firstHalfScoreDistribution(1.5, 1.2)
      expect(halfTime.expectedGoalsHome).toBeCloseTo(1.5 * 0.45, 2)
      expect(halfTime.expectedGoalsAway).toBeCloseTo(1.2 * 0.45, 2)
    })
  })
})

describe('足球資料集', () => {
  describe('parseFootballScore', () => {
    it('解析正常比分', () => {
      expect(parseFootballScore('2-1')).toEqual({ goalsA: 2, goalsB: 1 })
      expect(parseFootballScore('0:0')).toEqual({ goalsA: 0, goalsB: 0 })
    })

    it('解析帶空格的比分', () => {
      expect(parseFootballScore('3 - 2')).toEqual({ goalsA: 3, goalsB: 2 })
    })

    it('拒絕無效比分', () => {
      expect(parseFootballScore('')).toBeNull()
      expect(parseFootballScore('abc')).toBeNull()
    })
  })

  describe('parseFootballCsvRow', () => {
    it('解析有效的比賽資料', () => {
      const result = parseFootballCsvRow({
        date: '2026-01-15',
        discipline: 'FM',
        tournament: 'Test League',
        team1: 'Team A',
        team2: 'Team B',
        winner: '1',
        score: '2-1',
        team1_home: '1',
      })
      expect('match' in result).toBe(true)
      if ('match' in result) {
        expect(result.match.discipline).toBe('FM')
        expect(result.match.goalsA + result.match.goalsB).toBe(3)
        expect(result.match.matchLegal).toBe(true)
      }
    })

    it('解析和局', () => {
      const result = parseFootballCsvRow({
        date: '2026-01-15',
        discipline: 'FM',
        tournament: 'Test',
        team1: 'A',
        team2: 'B',
        winner: 'D',
        score: '1-1',
      })
      expect('match' in result).toBe(true)
      if ('match' in result) {
        expect(result.match.isDraw).toBe(true)
        expect(result.match.sideAWonMatch).toBeNull()
      }
    })

    it('拒絕超出範圍的日期', () => {
      const result = parseFootballCsvRow({
        date: '2027-02-01',
        discipline: 'FM',
        tournament: 'Test',
        team1: 'A',
        team2: 'B',
        winner: '1',
        score: '1-0',
      })
      expect('reason' in result && result.reason).toBe('out_of_range')
    })

    it('拒絕無效的項目', () => {
      const result = parseFootballCsvRow({
        date: '2026-01-15',
        discipline: 'XX',
        tournament: 'Test',
        team1: 'A',
        team2: 'B',
        winner: '1',
        score: '1-0',
      })
      expect('reason' in result && result.reason).toBe('bad_discipline')
    })
  })

  describe('footballDiscipline', () => {
    it('辨識男足', () => {
      expect(footballDiscipline('男子足球聯賽')).toBe('FM')
      expect(footballDiscipline("Men's Premier League")).toBe('FM')
    })

    it('辨識女足', () => {
      expect(footballDiscipline('女子足球聯賽')).toBe('FW')
      expect(footballDiscipline("Women's Football")).toBe('FW')
    })

    it('預設為男足', () => {
      expect(footballDiscipline('English Premier League')).toBe('FM')
    })
  })
})

describe('足球 Elo 模型', () => {
  it('1500 對 1500，主勝後 Elo 上升', () => {
    const next = updateElo(1500, 1500, 2, 1)
    expect(next.ratingA).toBeGreaterThan(1500)
    expect(next.ratingB).toBeLessThan(1500)
  })

  it('和局時 Elo 變動較小', () => {
    const draw = updateElo(1500, 1500, 1, 1)
    expect(draw.ratingA).toBe(1500)
    expect(draw.ratingB).toBe(1500)
  })

  it('平手起點的期望值是 0.5', () => {
    expect(expectedScore(FOOTBALL_INITIAL_ELO, FOOTBALL_INITIAL_ELO)).toBe(0.5)
  })

  it('主場優勢增加勝率', () => {
    const neutral = expectedScoreWithFactors(1500, 1500, false, 'neutral')
    const home = expectedScoreWithFactors(1500, 1500, true, 'club')
    expect(home).toBeGreaterThan(neutral)
  })

  it('detectHomeAdvantageMode 正確分類賽事', () => {
    expect(detectHomeAdvantageMode('English Premier League')).toBe('club')
    expect(detectHomeAdvantageMode('World Cup 2026')).toBe('neutral')
    expect(detectHomeAdvantageMode('UEFA Nations League')).toBe('neutral')
    expect(detectHomeAdvantageMode('La Liga')).toBe('club')
  })

  it('venueModeForQuote 報價語意', () => {
    expect(venueModeForQuote(true, 'Premier League')).toBe('club')
    expect(venueModeForQuote(false, 'Premier League')).toBe('neutral')
    expect(venueModeForQuote(true, 'World Cup')).toBe('neutral')
  })

  it('停賽把分數拉回 1500', () => {
    const active = effectiveRating(1800, 100, '2024-07-01', '2024-07-01', 'inactivity')
    const idle = effectiveRating(1800, 100, '2024-01-01', '2024-07-01', 'inactivity')
    expect(idle).toBeGreaterThan(FOOTBALL_INITIAL_ELO)
    expect(idle).toBeLessThan(active)
  })
})

describe('足球結算', () => {
  const score: FootballScore = { homeGoals: 2, awayGoals: 1, halfTimeHome: 1, halfTimeAway: 0 }

  describe('1X2 結算', () => {
    it('主勝時 home 結果為贏', () => {
      expect(settleFootballBet({ market: 'match1X2', outcomeKey: 'home', line: null }, score)).toBe('won')
    })

    it('主勝時 away 結果為輸', () => {
      expect(settleFootballBet({ market: 'match1X2', outcomeKey: 'away', line: null }, score)).toBe('lost')
    })

    it('主勝時 draw 結果為輸', () => {
      expect(settleFootballBet({ market: 'match1X2', outcomeKey: 'draw', line: null }, score)).toBe('lost')
    })

    it('和局時 draw 結果為贏', () => {
      const drawScore: FootballScore = { homeGoals: 1, awayGoals: 1 }
      expect(settleFootballBet({ market: 'match1X2', outcomeKey: 'draw', line: null }, drawScore)).toBe('won')
    })
  })

  describe('大小球結算', () => {
    it('3 球時大 2.5 為贏', () => {
      expect(settleFootballBet({ market: 'totals', outcomeKey: 'over', line: 2.5 }, score)).toBe('won')
    })

    it('3 球時小 2.5 為輸', () => {
      expect(settleFootballBet({ market: 'totals', outcomeKey: 'under', line: 2.5 }, score)).toBe('lost')
    })

    it('整數盤口走水', () => {
      const twoGoals: FootballScore = { homeGoals: 1, awayGoals: 1 }
      expect(settleFootballBet({ market: 'totals', outcomeKey: 'over', line: 2 }, twoGoals)).toBe('void')
    })
  })

  describe('讓球結算', () => {
    it('主讓 -0.5 時主勝 1 球為贏', () => {
      expect(settleFootballBet({ market: 'handicap', outcomeKey: 'home', line: 0.5 }, score)).toBe('won')
    })

    it('主讓 -1.5 時主勝 1 球，主隊為輸', () => {
      expect(settleFootballBet({ market: 'handicap', outcomeKey: 'home', line: 1.5 }, score)).toBe('lost')
    })

    it('整數盤口走水', () => {
      expect(settleFootballBet({ market: 'handicap', outcomeKey: 'home', line: 1 }, score)).toBe('void')
    })
  })

  describe('上半場 1X2 結算', () => {
    it('上半場主勝時 home 結果為贏', () => {
      expect(settleFootballBet({ market: 'firstHalf1X2', outcomeKey: 'home', line: null }, score)).toBe('won')
    })

    it('無上半場比分時為作廢', () => {
      const noHT: FootballScore = { homeGoals: 2, awayGoals: 1 }
      expect(settleFootballBet({ market: 'firstHalf1X2', outcomeKey: 'home', line: null }, noHT)).toBe('void')
    })
  })

  describe('正確比分結算', () => {
    it('2-1 結果正確', () => {
      expect(settleFootballBet({ market: 'correctScore', outcomeKey: '2:1', line: null }, score)).toBe('won')
    })

    it('非正確比分為輸', () => {
      expect(settleFootballBet({ market: 'correctScore', outcomeKey: '1:1', line: null }, score)).toBe('lost')
    })
  })
})

describe('足球 TSL 市場分類', () => {
  it('不讓分分類為 match1X2', () => {
    expect(classifyTslMarket('不讓分', 'football').kind).toBe('match1X2')
  })

  it('1X2 分類為 match1X2', () => {
    expect(classifyTslMarket('1X2', 'football').kind).toBe('match1X2')
  })

  it('大小分類為 totals', () => {
    expect(classifyTslMarket('大小 2.5', 'football').kind).toBe('totals')
    expect(classifyTslMarket('進球大小', 'football').kind).toBe('totals')
  })

  it('讓球分類為 handicap', () => {
    expect(classifyTslMarket('讓球 -0.5', 'football').kind).toBe('handicap')
    expect(classifyTslMarket('亞洲讓球', 'football').kind).toBe('handicap')
  })

  it('上半場市場分類正確', () => {
    expect(classifyTslMarket('上半場不讓分', 'football').kind).toBe('firstHalf1X2')
    expect(classifyTslMarket('上半場大小', 'football').kind).toBe('firstHalfTotals')
    expect(classifyTslMarket('上半場讓球', 'football').kind).toBe('firstHalfHandicap')
  })

  it('非足球市場不被錯誤分類', () => {
    expect(classifyTslMarket('不讓分', 'badminton').kind).toBe('match')
    expect(classifyTslMarket('[總分]大小', 'badminton').kind).toBe('totals')
  })
})
