/**
 * 足球進球模型
 *
 * 使用 Poisson/Dixon-Coles 模型預測比分分布。
 * Dixon-Coles 模型在低比分（0-0, 1-0, 0-1, 1-1）時有調整因子。
 *
 * 模型輸出：
 * - 每個比分的機率
 * - 1X2（主勝/和/客勝）機率
 * - 大小球機率
 * - 讓球機率
 */

import { logit } from './dist'

export type FootballScoreDistribution = {
  scores: Map<string, number>
  homeWin: number
  draw: number
  awayWin: number
  expectedGoalsHome: number
  expectedGoalsAway: number
}

const MAX_GOALS = 10

const factorial = (n: number): number => {
  if (n <= 1) return 1
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

const poisson = (lambda: number, k: number): number => {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k)
}

const DIXON_COLES_RHO = -0.13

const dixonColesAdjustment = (
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number => {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho
  }
  return 1
}

export const computeScoreDistribution = (
  lambdaHome: number,
  lambdaAway: number,
  rho = DIXON_COLES_RHO,
): FootballScoreDistribution => {
  const scores = new Map<string, number>()
  let homeWin = 0
  let draw = 0
  let awayWin = 0
  let totalProb = 0

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const baseProb = poisson(lambdaHome, h) * poisson(lambdaAway, a)
      const adjustment = dixonColesAdjustment(h, a, lambdaHome, lambdaAway, rho)
      const prob = baseProb * adjustment
      scores.set(`${h}:${a}`, prob)
      totalProb += prob

      if (h > a) homeWin += prob
      else if (h < a) awayWin += prob
      else draw += prob
    }
  }

  for (const [key, value] of scores) {
    scores.set(key, value / totalProb)
  }

  return {
    scores,
    homeWin: homeWin / totalProb,
    draw: draw / totalProb,
    awayWin: awayWin / totalProb,
    expectedGoalsHome: lambdaHome,
    expectedGoalsAway: lambdaAway,
  }
}

export const totalGoalsProbability = (
  distribution: FootballScoreDistribution,
  line: number,
  over: boolean,
): number => {
  let prob = 0
  for (const [key, value] of distribution.scores) {
    const [h, a] = key.split(':').map(Number) as [number, number]
    const total = h + a
    if (over ? total > line : total < line) {
      prob += value
    }
  }
  return prob
}

export const handicapProbability = (
  distribution: FootballScoreDistribution,
  homeLine: number,
  homeCovers: boolean,
): number => {
  let prob = 0
  for (const [key, value] of distribution.scores) {
    const [h, a] = key.split(':').map(Number) as [number, number]
    const margin = h - a + homeLine
    if (homeCovers ? margin > 0 : margin < 0) {
      prob += value
    }
  }
  return prob
}

export const correctScoreProbability = (
  distribution: FootballScoreDistribution,
  homeGoals: number,
  awayGoals: number,
): number => distribution.scores.get(`${homeGoals}:${awayGoals}`) ?? 0

export const correctScoreGroupProbability = (
  distribution: FootballScoreDistribution,
  scores: Array<[number, number]>,
): number => scores.reduce((sum, [h, a]) => sum + correctScoreProbability(distribution, h, a), 0)

export const firstHalfScoreDistribution = (
  lambdaHome: number,
  lambdaAway: number,
  rho = DIXON_COLES_RHO,
): FootballScoreDistribution => {
  const htLambdaHome = lambdaHome * 0.45
  const htLambdaAway = lambdaAway * 0.45
  return computeScoreDistribution(htLambdaHome, htLambdaAway, rho)
}

export type FootballGoalModel = {
  homeAttack: number
  homeDefense: number
  awayAttack: number
  awayDefense: number
  homeAdvantage: number
}

export const DEFAULT_GOAL_MODEL: FootballGoalModel = {
  homeAttack: 1.35,
  homeDefense: 1.0,
  awayAttack: 1.1,
  awayDefense: 1.0,
  homeAdvantage: 0.25,
}

export const expectedGoalsFromElo = (
  homeElo: number,
  awayElo: number,
  isHome: boolean,
  leagueAvgGoals = 2.6,
): { lambdaHome: number, lambdaAway: number } => {
  const eloDiff = homeElo - awayElo
  const homeAdvantage = isHome ? 0.25 : 0
  const strengthDiff = (eloDiff / 400) + homeAdvantage

  const baseHomeGoals = leagueAvgGoals / 2 * (1 + strengthDiff * 0.15)
  const baseAwayGoals = leagueAvgGoals / 2 * (1 - strengthDiff * 0.15)

  return {
    lambdaHome: Math.max(0.3, Math.min(4, baseHomeGoals)),
    lambdaAway: Math.max(0.3, Math.min(4, baseAwayGoals)),
  }
}

export const eloTo1X2 = (
  homeElo: number,
  awayElo: number,
  isHome: boolean,
): { home: number, draw: number, away: number } => {
  const { lambdaHome, lambdaAway } = expectedGoalsFromElo(homeElo, awayElo, isHome)
  const dist = computeScoreDistribution(lambdaHome, lambdaAway)
  return {
    home: dist.homeWin,
    draw: dist.draw,
    away: dist.awayWin,
  }
}

export const impliedProbabilitiesFrom1X2Odds = (
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
): { home: number, draw: number, away: number, vig: number } => {
  const impliedHome = 1 / homeOdds
  const impliedDraw = 1 / drawOdds
  const impliedAway = 1 / awayOdds
  const total = impliedHome + impliedDraw + impliedAway
  const vig = total - 1
  return {
    home: impliedHome / total,
    draw: impliedDraw / total,
    away: impliedAway / total,
    vig,
  }
}

export const lambdaFromProbabilities = (
  homeWin: number,
  draw: number,
  awayWin: number,
  maxIterations = 50,
): { lambdaHome: number, lambdaAway: number } => {
  let lambdaHome = 1.3
  let lambdaAway = 1.1

  for (let i = 0; i < maxIterations; i++) {
    const dist = computeScoreDistribution(lambdaHome, lambdaAway)
    const homeError = homeWin - dist.homeWin
    const drawError = draw - dist.draw

    const homeGradient = homeError > 0 ? 0.02 : -0.02
    const awayGradient = drawError > 0 ? -0.01 : 0.01

    if (homeError > 0) {
      lambdaHome += homeGradient
      lambdaAway -= homeGradient * 0.5
    } else {
      lambdaHome -= homeGradient
      lambdaAway += homeGradient * 0.5
    }

    lambdaHome = Math.max(0.3, Math.min(4, lambdaHome))
    lambdaAway = Math.max(0.3, Math.min(4, lambdaAway))

    if (Math.abs(homeError) < 0.01 && Math.abs(drawError) < 0.01) break
  }

  return { lambdaHome, lambdaAway }
}

export type Football1X2Probabilities = {
  home: number
  draw: number
  away: number
}

export const calibrate1X2Probabilities = (
  raw: Football1X2Probabilities,
  _bins: Array<{ predicted: number | null, actual: number | null }> = [],
): Football1X2Probabilities => {
  return raw
}
