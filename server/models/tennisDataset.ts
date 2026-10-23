/**
 * 網球資料集解析
 *
 * 支援：
 * 1. 簡化 CSV：date,discipline,tournament,tier,round,player1,player2,winner,score,surface
 *    score：6-4 6-3 或 6-4 3-6 7-6(5)
 * 2. Jeff Sackmann tennis_atp / tennis_wta 欄位（tourney_date, winner_name, loser_name, score, surface, best_of）
 *
 * 範圍：只納入 ATP/WTA 單打（運彩會開盤的職業賽事層級），略過雙打與 walkover。
 */

import type { TennisDiscipline } from '../../shared/types'
import { CUTOFF_DATE } from './constants'
import { tennisBestOf, type TennisDiscipline as SportTennisDiscipline } from '../../shared/sports'
import { toTslPlayerName } from './tennisNames'

export type TennisSurface = 'hard' | 'clay' | 'grass' | 'carpet'

export type TennisSetResult = {
  gamesA: number
  gamesB: number
  sideAWon: boolean
  isTiebreak: boolean
  isLegal: boolean
  tiebreakScore?: { a: number, b: number }
}

export type AcceptedTennisMatch = {
  matchId: string
  playedOn: string
  discipline: TennisDiscipline
  tournament: string
  tier: string
  round: string
  sideAId: string
  sideBId: string
  sideAName: string
  sideBName: string
  sets: TennisSetResult[]
  matchLegal: boolean
  set1Legal: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  surface?: TennisSurface
  bestOf: 3 | 5
}

export type TennisCsvRow = {
  date?: string
  discipline?: string
  tournament?: string
  tier?: string
  round?: string
  player1?: string
  player2?: string
  winner?: string
  score?: string
  surface?: string
  best_of?: string
}

export type SackmannRow = {
  tourney_date?: string
  tourney_name?: string
  tourney_level?: string
  surface?: string
  winner_name?: string
  loser_name?: string
  score?: string
  best_of?: string | number
  round?: string
  tourney_id?: string
  match_num?: string | number
}

export type RejectReason =
  | 'bad_date'
  | 'out_of_range'
  | 'bad_discipline'
  | 'missing_winner'
  | 'missing_name'
  | 'same_player'
  | 'bad_score'
  | 'walkover'
  | 'not_singles'
  | 'not_in_sample'

const SCORE_PATTERN = /^(\d+)-(\d+)(?:\((\d+)\))?$/

export const reverseTennisSetScore = (score: string) => {
  const matched = SCORE_PATTERN.exec(score.trim())
  if (!matched) return score
  const left = matched[1]!
  const right = matched[2]!
  const tiebreak = matched[3]
  return tiebreak ? `${right}-${left}(${tiebreak})` : `${right}-${left}`
}

const isValidSetScore = (gamesA: number, gamesB: number): boolean => {
  const winner = Math.max(gamesA, gamesB)
  const loser = Math.min(gamesA, gamesB)
  if (winner === 6 && loser <= 4) return true
  if (winner === 7 && (loser === 5 || loser === 6)) return true
  return false
}

export const parseTennisSets = (score: string, swap: boolean): TennisSetResult[] | null => {
  const cleaned = score.trim().replace(/RET|W\/O|DEF|ABN|Walkover/gi, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/).filter(part => SCORE_PATTERN.test(part))
  if (parts.length < 2 || parts.length > 5) return null

  const results: TennisSetResult[] = []
  let setsA = 0
  let setsB = 0

  for (const part of parts) {
    const matched = SCORE_PATTERN.exec(part)
    if (!matched) return null
    let gamesA = Number(matched[1])
    let gamesB = Number(matched[2])
    const tiebreakLoser = matched[3] ? Number(matched[3]) : undefined
    if (swap) [gamesA, gamesB] = [gamesB, gamesA]
    const sideAWon = gamesA > gamesB
    const isTiebreak = (gamesA === 7 && gamesB === 6) || (gamesA === 6 && gamesB === 7)
    results.push({
      gamesA,
      gamesB,
      sideAWon,
      isTiebreak,
      isLegal: isValidSetScore(gamesA, gamesB),
      tiebreakScore: tiebreakLoser !== undefined ? {
        a: sideAWon ? 7 : tiebreakLoser,
        b: sideAWon ? tiebreakLoser : 7,
      } : undefined,
    })
    if (sideAWon) setsA += 1
    else setsB += 1
    if (setsA === 2 || setsB === 2 || setsA === 3 || setsB === 3) {
      if (results.length >= 2) break
    }
  }

  return results.length >= 2 ? results : null
}

export const tennisDiscipline = (text: string): TennisDiscipline | null => {
  const lower = text.toLowerCase()
  if (lower.includes('double') || lower.includes('雙打')) return null
  if (
    lower.includes('wta')
    || lower.includes('女單')
    || lower.includes('女子')
    || lower.includes("women")
    || lower === 'w'
  ) return 'WTA'
  if (
    lower.includes('atp')
    || lower.includes('男單')
    || lower.includes('男子')
    || lower.includes('men')
    || lower === 'm'
  ) return 'ATP'
  if (text === 'ATP' || text === 'WTA') return text
  return null
}

export const tennisSurface = (text: string): TennisSurface | undefined => {
  const lower = text.toLowerCase()
  if (lower.includes('clay') || lower.includes('紅土')) return 'clay'
  if (lower.includes('grass') || lower.includes('草地')) return 'grass'
  if (lower.includes('carpet') || lower.includes('地毯')) return 'carpet'
  if (lower.includes('hard') || lower.includes('硬地')) return 'hard'
  return undefined
}

const playerIdentity = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { id: '', name: '' }
  return { id: toTslPlayerName(trimmed), name: toTslPlayerName(trimmed) }
}

const assessMatch = (sets: TennisSetResult[], bestOf: 3 | 5) => {
  const set1 = sets[0]
  const set1Legal = set1?.isLegal ?? false
  const needed = bestOf === 5 ? 3 : 2
  const winsA = sets.filter(set => set.sideAWon).length
  const winsB = sets.length - winsA
  const matchLegal = sets.every(set => set.isLegal) && (winsA === needed || winsB === needed)
  return {
    matchLegal,
    set1Legal,
    sideAWonMatch: matchLegal ? winsA === needed : null,
    sideAWonSet1: set1Legal ? (set1?.sideAWon ?? null) : null,
  }
}

export const parseTennisCsvRow = (
  row: TennisCsvRow,
): { match: AcceptedTennisMatch } | { reason: RejectReason } => {
  const playedOn = (row.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) return { reason: 'bad_date' }
  if (playedOn > CUTOFF_DATE) return { reason: 'out_of_range' }

  const discipline = tennisDiscipline(row.discipline ?? '')
  if (!discipline) return { reason: 'bad_discipline' }

  const winner = (row.winner ?? '').trim()
  if (winner !== '1' && winner !== '2') return { reason: 'missing_winner' }

  const player1 = playerIdentity(row.player1 ?? '')
  const player2 = playerIdentity(row.player2 ?? '')
  if (!player1.id || !player2.id) return { reason: 'missing_name' }
  if (player1.id === player2.id) return { reason: 'same_player' }

  const scoreText = row.score ?? ''
  if (/W\/O|Walkover|RET|DEF/i.test(scoreText) && !SCORE_PATTERN.test(scoreText.split(/\s+/)[0] ?? '')) {
    return { reason: 'walkover' }
  }

  const sideAIsPlayer1 = player1.id < player2.id
  const sets = parseTennisSets(scoreText, !sideAIsPlayer1)
  if (!sets) return { reason: 'bad_score' }

  const tournament = (row.tournament ?? '').trim()
  const bestOf = Number(row.best_of) === 5
    ? 5 as const
    : tennisBestOf(discipline as SportTennisDiscipline, tournament)
  const assessed = assessMatch(sets, bestOf)
  const player1Won = winner === '1'
  const sideAWonColumn = sideAIsPlayer1 ? player1Won : !player1Won
  const winnerConflict = assessed.matchLegal && assessed.sideAWonMatch !== sideAWonColumn
  const matchLegal = assessed.matchLegal && !winnerConflict
  if (!matchLegal && !assessed.set1Legal) return { reason: 'not_in_sample' }

  const sideA = sideAIsPlayer1 ? player1 : player2
  const sideB = sideAIsPlayer1 ? player2 : player1

  return {
    match: {
      matchId: [playedOn, discipline, tournament, sideA.id, sideB.id].join('|'),
      playedOn,
      discipline,
      tournament,
      tier: (row.tier ?? '').trim(),
      round: (row.round ?? '').trim(),
      sideAId: sideA.id,
      sideBId: sideB.id,
      sideAName: sideA.name,
      sideBName: sideB.name,
      sets,
      matchLegal,
      set1Legal: assessed.set1Legal,
      sideAWonMatch: matchLegal ? assessed.sideAWonMatch : null,
      sideAWonSet1: assessed.sideAWonSet1,
      surface: tennisSurface(row.surface ?? tournament),
      bestOf,
    },
  }
}

const sackmannDate = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

export const parseSackmannRow = (
  row: SackmannRow,
  discipline: TennisDiscipline,
): { match: AcceptedTennisMatch } | { reason: RejectReason } => {
  const playedOn = sackmannDate(String(row.tourney_date ?? ''))
  return parseTennisCsvRow({
    date: playedOn,
    discipline,
    tournament: row.tourney_name,
    tier: String(row.tourney_level ?? ''),
    round: String(row.round ?? ''),
    player1: row.winner_name,
    player2: row.loser_name,
    winner: '1',
    score: row.score,
    surface: row.surface,
    best_of: String(row.best_of ?? ''),
  })
}
