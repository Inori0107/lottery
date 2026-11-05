/**
 * 足球回測模組
 *
 * 功能：
 * 1. 從歷史資料建立 Elo 評分系統
 * 2. 訓練 Poisson/Dixon-Coles 進球模型
 * 3. 評估模型效能並校準
 * 4. 儲存模型參數與預測結果
 */

import type { FootballDiscipline, Split } from '../../shared/types'
import {
  FOOTBALL_INITIAL_ELO,
  FOOTBALL_INACTIVITY_HALF_LIFE_DAYS,
} from './constants'
import { effectiveRating, updateEloWithFactors, expectedScoreWithFactors, type HomeAdvantageMode } from './footballElo'
import {
  computeScoreDistribution,
  expectedGoalsFromElo,
  totalGoalsProbability,
  handicapProbability,
  eloTo1X2,
} from './footballGoals'
import { calibrationBins, logLoss, type CalibrationBin } from './game1'

export type FootballBacktestMatch = {
  matchId: string
  discipline: FootballDiscipline
  playedOn: string
  sideAId: string
  sideBId: string
  sideAIsHome: boolean
  homeAdvantageMode: HomeAdvantageMode
  includeMatch: boolean
  goalsA: number
  goalsB: number
  isDraw: boolean
  sideAWonMatch: boolean | null
}

export type FootballStoredRating = {
  discipline: FootballDiscipline
  teamId: string
  elo: number
  matchCount: number
  lastPlayedOn: string | null
  homeAdvantage: number
}

export type FootballMarketTest = {
  n: number
  logLoss: number | null
  baselineLogLoss: number | null
  calibration: CalibrationBin[]
}

export type FootballModelPayload = {
  trainEnd: string
  validEnd: string
  counts: Record<Split, { match: number }>
  shrink: {
    enabled: boolean
    mode: 'raw' | 'inactivity'
    halfLifeDays: number
  }
  validation: {
    match1X2Raw: number | null
    match1X2Idle: number | null
  }
  test: {
    match1X2: FootballMarketTest
    totals: FootballMarketTest
    handicap: FootballMarketTest
  }
  goalModel: {
    avgGoalsHome: number
    avgGoalsAway: number
    rho: number
  }
}

export type FootballDisciplineResult = {
  discipline: FootballDiscipline
  modelVersion: string
  payload: FootballModelPayload
  dataThrough: string
  ratings: FootballStoredRating[]
}

type TeamState = {
  elo: number
  matchCount: number
  lastPlayedOn: string | null
  homeAdvantage: number
}

type Snapshot = {
  matchId: string
  playedOn: string
  split: Split
  goalsA: number
  goalsB: number
  pHomeRaw: number
  pDrawRaw: number
  pAwayRaw: number
  pHomeIdle: number
  pDrawIdle: number
  pAwayIdle: number
  lambdaHomeRaw: number
  lambdaAwayRaw: number
  lambdaHomeIdle: number
  lambdaAwayIdle: number
  outcome1X2: 'home' | 'draw' | 'away'
}

const mean = (values: number[]) => values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null

const splitFor = (playedOn: string, trainEnd: string, validEnd: string): Split => {
  if (playedOn <= trainEnd) return 'train'
  if (playedOn <= validEnd) return 'valid'
  return 'test'
}

const emptyCounts = (): Record<Split, { match: number }> => ({
  train: { match: 0 },
  valid: { match: 0 },
  test: { match: 0 },
})

export const buildFootballModelVersion = (mode: 'raw' | 'inactivity') => {
  if (mode === 'inactivity') return `football-elo-k32-1500-h${FOOTBALL_INACTIVITY_HALF_LIFE_DAYS}-poisson-dc-v1`
  return `football-elo-k32-1500-raw-poisson-dc-v1`
}

export const runFootballDiscipline = (
  discipline: FootballDiscipline,
  matches: FootballBacktestMatch[],
): FootballDisciplineResult => {
  const ordered = [...matches].sort((left, right) =>
    left.playedOn.localeCompare(right.playedOn) || left.matchId.localeCompare(right.matchId),
  )

  const trainEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.7) - 1)]?.playedOn ?? '1970-01-01'
  const validEnd = ordered[Math.max(0, Math.floor(ordered.length * 0.85) - 1)]?.playedOn ?? trainEnd

  const state = new Map<string, TeamState>()
  const snapshots: Snapshot[] = []
  const counts = emptyCounts()

  let totalGoalsHome = 0
  let totalGoalsAway = 0
  let matchCount = 0

  const readState = (teamId: string) => {
    const existing = state.get(teamId)
    if (existing) return existing
    const created: TeamState = {
      elo: FOOTBALL_INITIAL_ELO,
      matchCount: 0,
      lastPlayedOn: null,
      homeAdvantage: 0,
    }
    state.set(teamId, created)
    return created
  }

  for (const match of ordered) {
    const sideA = readState(match.sideAId)
    const sideB = readState(match.sideBId)
    const split = splitFor(match.playedOn, trainEnd, validEnd)

    const ratingARaw = sideA.elo
    const ratingBRaw = sideB.elo
    const ratingAIdle = effectiveRating(sideA.elo, sideA.matchCount, sideA.lastPlayedOn, match.playedOn, 'inactivity')
    const ratingBIdle = effectiveRating(sideB.elo, sideB.matchCount, sideB.lastPlayedOn, match.playedOn, 'inactivity')

    const probsRaw = eloTo1X2(ratingARaw, ratingBRaw, match.sideAIsHome)
    const probsIdle = eloTo1X2(ratingAIdle, ratingBIdle, match.sideAIsHome)

    const goalsRaw = expectedGoalsFromElo(ratingARaw, ratingBRaw, match.sideAIsHome)
    const goalsIdle = expectedGoalsFromElo(ratingAIdle, ratingBIdle, match.sideAIsHome)

    const outcome1X2: 'home' | 'draw' | 'away' = match.isDraw ? 'draw' : (match.sideAWonMatch ? 'home' : 'away')

    if (match.includeMatch && match.sideAWonMatch !== null) {
      counts[split].match += 1
      snapshots.push({
        matchId: match.matchId,
        playedOn: match.playedOn,
        split,
        goalsA: match.goalsA,
        goalsB: match.goalsB,
        pHomeRaw: probsRaw.home,
        pDrawRaw: probsRaw.draw,
        pAwayRaw: probsRaw.away,
        pHomeIdle: probsIdle.home,
        pDrawIdle: probsIdle.draw,
        pAwayIdle: probsIdle.away,
        lambdaHomeRaw: goalsRaw.lambdaHome,
        lambdaAwayRaw: goalsRaw.lambdaAway,
        lambdaHomeIdle: goalsIdle.lambdaHome,
        lambdaAwayIdle: goalsIdle.lambdaAway,
        outcome1X2,
      })

      if (split === 'train') {
        totalGoalsHome += match.goalsA
        totalGoalsAway += match.goalsB
        matchCount += 1
      }

      const next = updateEloWithFactors(
        sideA.elo,
        sideB.elo,
        match.goalsA,
        match.goalsB,
        match.sideAIsHome,
        match.homeAdvantageMode,
      )
      sideA.elo = next.ratingA
      sideB.elo = next.ratingB
      sideA.matchCount += 1
      sideB.matchCount += 1
    }

    sideA.lastPlayedOn = match.playedOn
    sideB.lastPlayedOn = match.playedOn
  }

  const avgGoalsHome = matchCount > 0 ? totalGoalsHome / matchCount : 1.35
  const avgGoalsAway = matchCount > 0 ? totalGoalsAway / matchCount : 1.1
  const rho = -0.13

  const validSnapshots = snapshots.filter(row => row.split === 'valid')
  const validation1X2Raw = validSnapshots.length > 0
    ? mean(validSnapshots.map(row => {
        const p = row.outcome1X2 === 'home' ? row.pHomeRaw : row.outcome1X2 === 'draw' ? row.pDrawRaw : row.pAwayRaw
        return logLoss(p, 1)
      }))
    : null
  const validation1X2Idle = validSnapshots.length > 0
    ? mean(validSnapshots.map(row => {
        const p = row.outcome1X2 === 'home' ? row.pHomeIdle : row.outcome1X2 === 'draw' ? row.pDrawIdle : row.pAwayIdle
        return logLoss(p, 1)
      }))
    : null

  const shrinkMode: 'raw' | 'inactivity' =
    validation1X2Idle !== null && validation1X2Raw !== null && validation1X2Idle < validation1X2Raw
      ? 'inactivity'
      : 'raw'

  const modelVersion = buildFootballModelVersion(shrinkMode)

  const testSnapshots = snapshots.filter(row => row.split === 'test')

  const pHome = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pHomeIdle : row.pHomeRaw
  const pDraw = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pDrawIdle : row.pDrawRaw
  const pAway = (row: Snapshot) => shrinkMode === 'inactivity' ? row.pAwayIdle : row.pAwayRaw
  const lambdaHome = (row: Snapshot) => shrinkMode === 'inactivity' ? row.lambdaHomeIdle : row.lambdaHomeRaw
  const lambdaAway = (row: Snapshot) => shrinkMode === 'inactivity' ? row.lambdaAwayIdle : row.lambdaAwayRaw

  const match1X2Test: FootballMarketTest = {
    n: testSnapshots.length,
    logLoss: testSnapshots.length > 0
      ? mean(testSnapshots.map(row => {
          const p = row.outcome1X2 === 'home' ? pHome(row) : row.outcome1X2 === 'draw' ? pDraw(row) : pAway(row)
          return logLoss(p, 1)
        }))
      : null,
    baselineLogLoss: testSnapshots.length > 0 ? mean(testSnapshots.map(() => logLoss(1 / 3, 1))) : null,
    calibration: calibrationBins(testSnapshots.flatMap(row => [
      { p: pHome(row), y: row.outcome1X2 === 'home' ? 1 : 0 },
      { p: pDraw(row), y: row.outcome1X2 === 'draw' ? 1 : 0 },
      { p: pAway(row), y: row.outcome1X2 === 'away' ? 1 : 0 },
    ])),
  }

  const totalsTest: FootballMarketTest = {
    n: testSnapshots.length,
    logLoss: testSnapshots.length > 0
      ? mean(testSnapshots.map(row => {
          const dist = computeScoreDistribution(lambdaHome(row), lambdaAway(row), rho)
          const total = row.goalsA + row.goalsB
          const p = totalGoalsProbability(dist, 2.5, total > 2.5)
          return logLoss(p, 1)
        }))
      : null,
    baselineLogLoss: testSnapshots.length > 0 ? mean(testSnapshots.map(() => logLoss(0.5, 1))) : null,
    calibration: calibrationBins(testSnapshots.map(row => {
      const dist = computeScoreDistribution(lambdaHome(row), lambdaAway(row), rho)
      const total = row.goalsA + row.goalsB
      return { p: totalGoalsProbability(dist, 2.5, true), y: total > 2.5 ? 1 : 0 }
    })),
  }

  const handicapTest: FootballMarketTest = {
    n: testSnapshots.length,
    logLoss: testSnapshots.length > 0
      ? mean(testSnapshots.map(row => {
          const dist = computeScoreDistribution(lambdaHome(row), lambdaAway(row), rho)
          const margin = row.goalsA - row.goalsB
          const p = handicapProbability(dist, -0.5, margin > 0.5)
          return logLoss(p, 1)
        }))
      : null,
    baselineLogLoss: testSnapshots.length > 0 ? mean(testSnapshots.map(() => logLoss(0.5, 1))) : null,
    calibration: calibrationBins(testSnapshots.map(row => {
      const dist = computeScoreDistribution(lambdaHome(row), lambdaAway(row), rho)
      const margin = row.goalsA - row.goalsB
      return { p: handicapProbability(dist, -0.5, true), y: margin > 0.5 ? 1 : 0 }
    })),
  }

  return {
    discipline,
    modelVersion,
    dataThrough: ordered[ordered.length - 1]?.playedOn ?? '',
    ratings: [...state.entries()].map(([teamId, team]) => ({
      discipline,
      teamId,
      elo: team.elo,
      matchCount: team.matchCount,
      lastPlayedOn: team.lastPlayedOn,
      homeAdvantage: team.homeAdvantage,
    })),
    payload: {
      trainEnd,
      validEnd,
      counts,
      shrink: {
        enabled: shrinkMode !== 'raw',
        mode: shrinkMode,
        halfLifeDays: FOOTBALL_INACTIVITY_HALF_LIFE_DAYS,
      },
      validation: {
        match1X2Raw: validation1X2Raw,
        match1X2Idle: validation1X2Idle,
      },
      test: {
        match1X2: match1X2Test,
        totals: totalsTest,
        handicap: handicapTest,
      },
      goalModel: {
        avgGoalsHome,
        avgGoalsAway,
        rho,
      },
    },
  }
}

export const runFootballBacktest = (matches: FootballBacktestMatch[]) => {
  const disciplines: FootballDiscipline[] = ['FM', 'FW']
  return disciplines.map(discipline =>
    runFootballDiscipline(discipline, matches.filter(match => match.discipline === discipline)),
  )
}
