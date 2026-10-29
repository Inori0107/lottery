import type { BetMarket, BetRecord, BetStats, BetStatus } from '../../shared/types'
import { devigMultiWay } from './odds'

export type GameScore = { away: number, home: number }

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

export const settleBet = (bet: SettleInput, games: GameScore[], setsToWin = 2): BetStatus => {
  if (!isCompleteMatch(games, setsToWin)) return 'void'
  const won = gamesWon(games)
  const awayPoints = games.reduce((sum, game) => sum + game.away, 0)
  const homePoints = games.reduce((sum, game) => sum + game.home, 0)

  if (bet.market === 'match') {
    const awayWon = won.away === setsToWin
    return outcome(bet.outcomeKey === 'away' ? awayWon : !awayWon)
  }
  if (bet.market === 'game1' || bet.market === 'set1') {
    const first = games[0]!
    const awayWon = first.away > first.home
    return outcome(bet.outcomeKey === 'away' ? awayWon : !awayWon)
  }
  if (bet.market === 'totals' || bet.market === 'set1Totals') {
    if (bet.line === null) return 'void'
    const points = bet.market === 'set1Totals'
      ? games[0]!.away + games[0]!.home
      : awayPoints + homePoints
    const over = points > bet.line
    return outcome(bet.outcomeKey === 'over' ? over : !over)
  }
  if (bet.market === 'handicap' || bet.market === 'set1Handicap') {
    if (bet.line === null) return 'void'
    const margin = bet.market === 'set1Handicap'
      ? games[0]!.away - games[0]!.home
      : awayPoints - homePoints
    const awayCovers = margin + bet.line > 0
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

