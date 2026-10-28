import { isDoublesEvent, tennisBestOf, type TennisDiscipline } from '../../shared/sports'

export type TennisCsvRow = {
  date?: string
  discipline?: string
  tournament?: string
  round?: string
  player1?: string
  player2?: string
  winner?: string
  score?: string
}

export type RejectReason =
  | 'bad_date'
  | 'out_of_range'
  | 'bad_discipline'
  | 'missing_winner'
  | 'missing_name'
  | 'same_player'
  | 'bad_score'
  | 'not_in_sample'

export type ScoredTennisSet = {
  gamesA: number
  gamesB: number
  sideAWon: boolean
  isLegal: boolean
}

export type AcceptedTennisMatch = {
  matchId: string
  playedOn: string
  discipline: TennisDiscipline
  tournament: string
  round: string
  sourcePlayer1Id: string
  sourcePlayer2Id: string
  sourcePlayer1Name: string
  sourcePlayer2Name: string
  sideAId: string
  sideBId: string
  sideAName: string
  sideBName: string
  sets: ScoredTennisSet[]
  matchLegal: boolean
  set1Legal: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  winnerConflict: boolean
  bestOf: 3 | 5
}

const CUTOFF_DATE = '2027-01-01'

export const playerIdentity = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  const matched = trimmed.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  if (matched?.[1] && matched[2]) {
    return { id: matched[2].trim(), name: matched[1].trim() }
  }
  return { id: trimmed, name: trimmed }
}

export const isLegalTennisSet = (gamesA: number, gamesB: number, isDecidingSet: boolean) => {
  const high = Math.max(gamesA, gamesB)
  const low = Math.min(gamesA, gamesB)
  if (high === 6 && low <= 4) return true
  if (high === 7 && (low === 5 || low === 6)) return true
  if (isDecidingSet && high >= 10 && high - low >= 2) return true
  return false
}

export const parseTennisSets = (score: string, swap: boolean, bestOf: 3 | 5): ScoredTennisSet[] | null => {
  const parts = score.trim().split(/\s+/).filter(Boolean)
  const setsToWin = bestOf === 5 ? 3 : 2
  const maxSets = bestOf
  if (parts.length < setsToWin || parts.length > maxSets) return null

  const sets: ScoredTennisSet[] = []
  let winsA = 0
  let winsB = 0

  for (const part of parts) {
    const matched = part.match(/^(\d+)-(\d+)$/)
    if (!matched?.[1] || !matched[2]) return null
    const team1 = Number(matched[1])
    const team2 = Number(matched[2])
    const gamesA = swap ? team2 : team1
    const gamesB = swap ? team1 : team2
    const isDecidingSet = winsA === setsToWin - 1 && winsB === setsToWin - 1
    sets.push({
      gamesA,
      gamesB,
      sideAWon: gamesA > gamesB,
      isLegal: isLegalTennisSet(gamesA, gamesB, isDecidingSet),
    })
    if (gamesA > gamesB) winsA += 1
    else winsB += 1
  }
  return sets
}

const assessTennisMatch = (sets: ScoredTennisSet[], setsToWin: number) => {
  const set1 = sets[0]
  const set1Legal = set1?.isLegal ?? false
  const sideAWonSet1 = set1Legal ? (set1?.sideAWon ?? null) : null
  const winsA = sets.filter(set => set.sideAWon).length
  const winsB = sets.length - winsA
  const matchLegal = sets.every(set => set.isLegal) && (winsA === setsToWin) !== (winsB === setsToWin)
    && (winsA === setsToWin || winsB === setsToWin)
  const sideAWonMatch = matchLegal ? winsA === setsToWin : null
  return { matchLegal, set1Legal, sideAWonMatch, sideAWonSet1 }
}

export const tennisDiscipline = (value: string): TennisDiscipline | null => {
  const trimmed = value.trim()
  if (isDoublesEvent(trimmed)) return null
  const lower = trimmed.toLowerCase()
  if (trimmed === 'WTA' || lower.includes('wta') || lower.includes('women') || lower.includes('女')) return 'WTA'
  return 'ATP'
}

export const parseTennisCsvRow = (
  row: TennisCsvRow,
): { match: AcceptedTennisMatch } | { reason: RejectReason } => {
  const playedOn = (row.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) return { reason: 'bad_date' }
  if (playedOn >= CUTOFF_DATE) return { reason: 'out_of_range' }

  const discipline = tennisDiscipline((row.discipline ?? '').trim())
  if (!discipline) return { reason: 'bad_discipline' }

  const winner = (row.winner ?? '').trim()
  if (winner !== '1' && winner !== '2') return { reason: 'missing_winner' }

  const player1 = playerIdentity(row.player1 ?? '')
  const player2 = playerIdentity(row.player2 ?? '')
  if (!player1.id || !player2.id) return { reason: 'missing_name' }
  if (player1.id === player2.id) return { reason: 'same_player' }

  const tournament = (row.tournament ?? '').trim()
  const bestOf = tennisBestOf(tournament, discipline)
  const setsToWin = bestOf === 5 ? 3 : 2
  const sideAIsPlayer1 = player1.id < player2.id
  const sets = parseTennisSets(row.score ?? '', !sideAIsPlayer1, bestOf)
  if (!sets) return { reason: 'bad_score' }

  const assessed = assessTennisMatch(sets, setsToWin)
  const player1Won = winner === '1'
  const sideAWonColumn = sideAIsPlayer1 ? player1Won : !player1Won
  const winnerConflict = assessed.matchLegal && assessed.sideAWonMatch !== sideAWonColumn
  const matchLegal = assessed.matchLegal && !winnerConflict
  const sideAWonMatch = matchLegal ? assessed.sideAWonMatch : null
  if (!matchLegal && !assessed.set1Legal) return { reason: 'not_in_sample' }

  const sideA = sideAIsPlayer1 ? player1 : player2
  const sideB = sideAIsPlayer1 ? player2 : player1
  return {
    match: {
      matchId: `${playedOn}|${discipline}|${[player1.id, player2.id].sort().join('|')}|${row.round ?? ''}`,
      playedOn,
      discipline,
      tournament,
      round: (row.round ?? '').trim(),
      sourcePlayer1Id: player1.id,
      sourcePlayer2Id: player2.id,
      sourcePlayer1Name: player1.name,
      sourcePlayer2Name: player2.name,
      sideAId: sideA.id,
      sideBId: sideB.id,
      sideAName: sideA.name,
      sideBName: sideB.name,
      sets,
      matchLegal,
      set1Legal: assessed.set1Legal,
      sideAWonMatch,
      sideAWonSet1: assessed.sideAWonSet1,
      winnerConflict,
      bestOf,
    },
  }
}
