import type { BetMarket, BetRecord, BetStats, BetStatus, Sport } from '../../shared/types'
import { devigMultiWay } from './odds'

export type GameScore = { away: number, home: number }

export type FootballScore = { homeGoals: number, awayGoals: number, halfTimeHome?: number, halfTimeAway?: number }

export type SettleInput = {
  market: BetMarket
  outcomeKey: string
  line: number | null
}

export const parseGameScores = (score: string): GameScore[] =>
  score.trim().split(/\s+/).filter(Boolean).flatMap((game) => {
    const matched = game.match(/^(\d+)-(\d+)$/)
    return matched ? [{ away: Number(matched[1]), home: Number(matched[2]) }] : []
  })

export const formatGameScores = (games: GameScore[]) =>
  games.map(game => `${game.away}-${game.home}`).join(' ')

const gamesWon = (games: GameScore[]) => ({
  away: games.filter(game => game.away > game.home).length,
  home: games.filter(game => game.home > game.away).length,
})

const isCompleteMatch = (games: GameScore[], setsToWin: number) => {
  const won = gamesWon(games)
  const maxSets = setsToWin * 2 - 1
  return games.length >= setsToWin
    && games.length <= maxSets
    && (won.away === setsToWin) !== (won.home === setsToWin)
}

const outcome = (won: boolean): BetStatus => (won ? 'won' : 'lost')

const setsToWinOf = (sportOrSets: Sport | number = 2) => {
  if (typeof sportOrSets === 'number') return sportOrSets
  return sportOrSets === 'volleyball' ? 3 : 2
}

const firstSet = (games: GameScore[]) => games[0] ?? null

export const settleFootballBet = (bet: SettleInput, score: FootballScore): BetStatus => {
  const { homeGoals, awayGoals, halfTimeHome, halfTimeAway } = score

  if (bet.market === 'match1X2') {
    if (homeGoals > awayGoals) return outcome(bet.outcomeKey === 'home')
    if (awayGoals > homeGoals) return outcome(bet.outcomeKey === 'away')
    return outcome(bet.outcomeKey === 'draw')
  }

  if (bet.market === 'firstHalf1X2') {
    if (halfTimeHome === undefined || halfTimeAway === undefined) return 'void'
    if (halfTimeHome > halfTimeAway) return outcome(bet.outcomeKey === 'home')
    if (halfTimeAway > halfTimeHome) return outcome(bet.outcomeKey === 'away')
    return outcome(bet.outcomeKey === 'draw')
  }

  if (bet.market === 'totals') {
    if (bet.line === null) return 'void'
    const total = homeGoals + awayGoals
    if (total === bet.line) return 'void'
    const over = total > bet.line
    return outcome(bet.outcomeKey === 'over' ? over : !over)
  }

  if (bet.market === 'firstHalfTotals') {
    if (halfTimeHome === undefined || halfTimeAway === undefined || bet.line === null) return 'void'
    const total = halfTimeHome + halfTimeAway
    if (total === bet.line) return 'void'
    const over = total > bet.line
    return outcome(bet.outcomeKey === 'over' ? over : !over)
  }

  if (bet.market === 'handicap') {
    if (bet.line === null) return 'void'
    const adjustedMargin = awayGoals - homeGoals + bet.line
    if (adjustedMargin === 0) return 'void'
    const awayCovers = adjustedMargin > 0
    return outcome(bet.outcomeKey === 'away' ? awayCovers : !awayCovers)
  }

  if (bet.market === 'firstHalfHandicap') {
    if (halfTimeHome === undefined || halfTimeAway === undefined || bet.line === null) return 'void'
    const adjustedMargin = halfTimeAway - halfTimeHome + bet.line
    if (adjustedMargin === 0) return 'void'
    const awayCovers = adjustedMargin > 0
    return outcome(bet.outcomeKey === 'away' ? awayCovers : !awayCovers)
  }

  if (bet.market === 'correctScore') {
    return outcome(bet.outcomeKey === `${homeGoals}:${awayGoals}`)
  }

  return 'void'
}

export const settleBet = (bet: SettleInput, games: GameScore[], sportOrSets: Sport | number = 2): BetStatus => {
  const setsToWin = setsToWinOf(sportOrSets)
  if (bet.market === 'set1' || bet.market === 'game1') {
    const first = firstSet(games)
    if (!first) return 'void'
    const awayWon = first.away > first.home
    return outcome(bet.outcomeKey === 'away' ? awayWon : !awayWon)
  }
  if (bet.market === 'set1Totals') {
    const first = firstSet(games)
    if (!first || bet.line === null) return 'void'
    const over = first.away + first.home > bet.line
    return outcome(bet.outcomeKey === 'over' ? over : !over)
  }
  if (bet.market === 'set1Handicap') {
    const first = firstSet(games)
    if (!first || bet.line === null) return 'void'
    const awayCovers = first.away - first.home + bet.line > 0
    return outcome(bet.outcomeKey === 'away' ? awayCovers : !awayCovers)
  }
  if (!isCompleteMatch(games, setsToWin)) return 'void'
  const won = gamesWon(games)
  const awayPoints = games.reduce((sum, game) => sum + game.away, 0)
  const homePoints = games.reduce((sum, game) => sum + game.home, 0)

  if (bet.market === 'match') {
    const awayWon = won.away === setsToWin
    return outcome(bet.outcomeKey === 'away' ? awayWon : !awayWon)
  }
  if (bet.market === 'totals') {
    if (bet.line === null) return 'void'
    const over = awayPoints + homePoints > bet.line
    return outcome(bet.outcomeKey === 'over' ? over : !over)
  }
  if (bet.market === 'handicap') {
    if (bet.line === null) return 'void'
    const awayCovers = awayPoints - homePoints + bet.line > 0
    return outcome(bet.outcomeKey === 'away' ? awayCovers : !awayCovers)
  }
  if (bet.market === 'setHandicap') {
    if (bet.line === null) return 'void'
    const awayCovers = won.away - won.home + bet.line > 0
    return outcome(bet.outcomeKey === 'away' ? awayCovers : !awayCovers)
  }
  if (bet.market === 'setCount') {
    return outcome(bet.outcomeKey === String(games.length))
  }
  return outcome(bet.outcomeKey === `${won.away}:${won.home}`)
}

export const settleParlayStatus = (legStatuses: BetStatus[]): BetStatus => {
  if (legStatuses.length === 0 || legStatuses.includes('open')) return 'open'
  if (legStatuses.includes('lost')) return 'lost'
  if (legStatuses.every(status => status === 'won')) return 'won'
  return 'void'
}

export const betPayout = (status: BetStatus, stake: number, odds: number) => {
  if (status === 'won') return Math.round(stake * odds * 100) / 100
  if (status === 'void') return stake
  if (status === 'lost') return 0
  return null
}

export type OddsSnapshot = {
  outcomeKey: string
  line: number | null
  odds: number
  capturedAt: string
}

export type ClosingOdds = { odds: number, market: number }

export const closingOdds = (
  snapshots: OddsSnapshot[],
  bet: { outcomeKey: string, line: number | null },
  startsAt: string,
): ClosingOdds | null => {
  const beforeStart = snapshots.filter(snapshot => snapshot.capturedAt < startsAt)
  const lastCapture = beforeStart.reduce<string | null>(
    (latest, snapshot) => (latest === null || snapshot.capturedAt > latest ? snapshot.capturedAt : latest),
    null,
  )
  if (!lastCapture) return null
  const closing = beforeStart.filter(snapshot => snapshot.capturedAt === lastCapture)
  const index = closing.findIndex(snapshot => snapshot.outcomeKey === bet.outcomeKey)
  const picked = closing[index]
  if (!picked || picked.line !== bet.line) return null
  const market = devigMultiWay(closing.map(snapshot => snapshot.odds))[index]
  return market === undefined ? null : { odds: picked.odds, market }
}

export const closingOddsAfterPrediction = (
  snapshots: OddsSnapshot[],
  bet: { outcomeKey: string, line: number | null },
  startsAt: string,
  predictedAt: string,
): ClosingOdds | null => {
  const later = snapshots.filter(snapshot => snapshot.capturedAt > predictedAt)
  return closingOdds(later, bet, startsAt)
}

export const closingLineValue = (odds: number, closing: number | null) =>
  closing === null ? null : odds / closing - 1

const average = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length

export const summarizeBets = (bets: BetRecord[]): BetStats => {
  const won = bets.filter(bet => bet.status === 'won')
  const lost = bets.filter(bet => bet.status === 'lost')
  const decided = [...won, ...lost]
  const staked = decided.reduce((sum, bet) => sum + bet.stake, 0)
  const profit = decided.reduce((sum, bet) => sum + (bet.payout ?? 0) - bet.stake, 0)
  const clvs = bets.flatMap(bet => (bet.clv === null ? [] : [bet.clv]))
  return {
    count: bets.length,
    open: bets.filter(bet => bet.status === 'open').length,
    won: won.length,
    lost: lost.length,
    void: bets.filter(bet => bet.status === 'void').length,
    winRate: decided.length === 0 ? null : won.length / decided.length,
    staked,
    profit: Math.round(profit * 100) / 100,
    roi: staked === 0 ? null : profit / staked,
    averageEv: average(bets.flatMap(bet => (bet.ev === null ? [] : [bet.ev]))),
    averageClv: average(clvs),
    positiveClvRate: clvs.length === 0 ? null : clvs.filter(value => value > 0).length / clvs.length,
  }
}

