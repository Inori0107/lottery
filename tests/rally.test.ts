import { describe, expect, it } from 'vitest'
import {
  coversHandicap,
  distributionMean,
  fairLine,
  fitRallyLogistic,
  gameScoreDistribution,
  matchDistribution,
  probabilityAbove,
  rallyProbability,
} from '../server/models/rally'
import { isLegalGame } from '../server/models/scoring'
import { quotePlayersWithForm } from '../server/models/quote'
import { buildBins } from '../server/models/game1'

const sumOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0)

describe('每球模型', () => {
  it('單局分布總和為 1、比分都合法、50% 時對稱', () => {
    const scores = gameScoreDistribution(0.5)
    expect(sumOf(scores.map(score => score.probability))).toBeCloseTo(1, 10)
    expect(scores.every(score => isLegalGame(score.pointsA, score.pointsB))).toBe(true)
    const winsA = sumOf(scores.filter(score => score.pointsA > score.pointsB).map(score => score.probability))
    expect(winsA).toBeCloseTo(0.5, 10)
  })

  it('每球勝率越高，2:0 機率越高，正確比數總和為 1', () => {
    const low = matchDistribution(0.5)
    const high = matchDistribution(0.55)
    expect(high.correctScore['2:0']).toBeGreaterThan(low.correctScore['2:0'])
    expect(sumOf(Object.values(high.correctScore))).toBeCloseTo(1, 10)
    expect(sumOf(high.total.values)).toBeCloseTo(1, 10)
    expect(sumOf(high.margin.values)).toBeCloseTo(1, 10)
  })

  it('整場狀態波動讓三局比賽變少，分布仍總和為 1', () => {
    const independent = matchDistribution(0.5)
    const correlated = matchDistribution(0.5, 0.05, 0.4)
    const threeGames = (distribution: typeof independent) =>
      distribution.correctScore['2:1'] + distribution.correctScore['1:2']
    expect(threeGames(correlated)).toBeLessThan(threeGames(independent))
    expect(sumOf(Object.values(correlated.correctScore))).toBeCloseTo(1, 10)
    expect(sumOf(correlated.total.values)).toBeCloseTo(1, 10)
    expect(sumOf(gameScoreDistribution(0.55, 0.3).map(score => score.probability))).toBeCloseTo(1, 10)
  })

  it('大小機率與總分分布一致，公平線接近 50%', () => {
    const distribution = matchDistribution(0.52)
    const line = fairLine(distribution.total)
    expect(Number.isInteger(line * 2) && !Number.isInteger(line)).toBe(true)
    expect(Math.abs(probabilityAbove(distribution.total, line) - 0.5)).toBeLessThan(0.05)
    expect(probabilityAbove(distribution.total, 0.5)).toBeCloseTo(1, 10)
    expect(distributionMean(distribution.total)).toBeGreaterThan(70)
  })

  it('交換雙方時比數與分差鏡射', () => {
    const forward = matchDistribution(0.53)
    const reverse = matchDistribution(0.47)
    expect(forward.correctScore['2:1']).toBeCloseTo(reverse.correctScore['1:2'], 10)
    expect(distributionMean(forward.margin)).toBeCloseTo(-distributionMean(reverse.margin), 10)
    expect(coversHandicap(forward.margin, -4.5)).toBeCloseTo(1 - coversHandicap(reverse.margin, 4.5), 10)
  })

  it('擬合會跟著 Elo 差的方向移動', () => {
    const rows = [
      { eloDiff: 200, pointsA: 21, pointsB: 15 },
      { eloDiff: 200, pointsA: 21, pointsB: 17 },
      { eloDiff: -200, pointsA: 14, pointsB: 21 },
      { eloDiff: -200, pointsA: 18, pointsB: 21 },
    ]
    const coefficients = fitRallyLogistic(rows)
    expect(rallyProbability(coefficients, 200)).toBeGreaterThan(0.5)
    expect(rallyProbability(coefficients, -200)).toBeLessThan(0.5)
  })
})

describe('分數玩法報價', () => {
  const model = {
    method: 'bo3' as const,
    coefficients: [0, 0, 0] as [number, number, number],
    bins: buildBins([]),
    shrinkMode: 'raw' as const,
    rally: { coefficients: [0, 0.0015] as [number, number], sigma: 0.05, tau: 0.35 },
  }
  const away = { id: 'a', name: 'A', elo: 1700, matchCount: 60, set1Count: 60, lastPlayedOn: '2024-01-01', game1Recent: [1] }
  const home = { id: 'b', name: 'B', elo: 1500, matchCount: 60, set1Count: 60, lastPlayedOn: '2024-01-01', game1Recent: [0] }

  const correctScoreOdds = { '2:0': 2.2, '2:1': 3.3, '1:2': 4.35, '0:2': 3.2 }

  it('客隊較強時客隊 2:0 機率最高，讓分線照輸入顯示', () => {
    const quoted = quotePlayersWithForm(away, home, model, {
      handicap: { awayLine: -4.5, away: 1.72, home: 1.72 },
      correctScore: correctScoreOdds,
    }, '2024-01-01')
    expect(quoted.pointsHandicap?.outcomes.map(outcome => outcome.label)).toEqual(['A -4.5', 'B +4.5'])
    const best = [...quoted.correctScore?.outcomes ?? []].sort((left, right) => right.probability - left.probability)[0]
    expect(best?.key).toBe('2:0')
  })

  it('主客對調時正確比數鏡射', () => {
    const forward = quotePlayersWithForm(away, home, model, { correctScore: correctScoreOdds }, '2024-01-01')
    const reverse = quotePlayersWithForm(home, away, model, { correctScore: correctScoreOdds }, '2024-01-01')
    const probabilityOf = (quote: typeof forward, key: string) =>
      quote.correctScore?.outcomes.find(outcome => outcome.key === key)?.probability ?? 0
    expect(probabilityOf(forward, '2:0')).toBeCloseTo(probabilityOf(reverse, '0:2'), 10)
  })

  it('沒填的分數玩法不計算，有填的才算期望值', () => {
    const quoted = quotePlayersWithForm(away, home, model, {
      totals: { line: 80.5, over: 1.72, under: 1.72 },
    }, '2024-01-01')
    expect(quoted.totalPoints?.line).toBe(80.5)
    expect(quoted.totalPoints?.outcomes.every(outcome => outcome.ev !== null)).toBe(true)
    expect(quoted.pointsHandicap).toBeNull()
    expect(quoted.correctScore).toBeNull()

    const nothing = quotePlayersWithForm(away, home, model, {}, '2024-01-01')
    expect(nothing.totalPoints).toBeNull()
  })

  it('有填但沒有分數模型時標示不評估', () => {
    const withoutRally = quotePlayersWithForm(away, home, { ...model, rally: undefined }, {
      totals: { line: 80.5, over: 1.72, under: 1.72 },
    }, '2024-01-01')
    expect(withoutRally.totalPoints?.status).toBe('insufficient')
    expect(withoutRally.correctScore).toBeNull()
  })
})
