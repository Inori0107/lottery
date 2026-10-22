import { CUTOFF_DATE } from './constants'
import { assessMatch, isLegalGame, type ScoredGame } from './scoring'

export type CsvRow = {
  date?: string
  discipline?: string
  tournament?: string
  tier?: string
  round?: string
  host_location?: string
  team1?: string
  team2?: string
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

const TIER_ALIASES: Record<string, string> = {
  'HSBC BWF World Tour Super 1000': '超級 1000',
  'HSBC BWF World Tour Super 750': '超級 750',
  'HSBC BWF World Tour Super 500': '超級 500',
  'HSBC BWF World Tour Super 300': '超級 300',
  'BWF Tour Super 100': '超級 100',
  'HSBC BWF World Tour Finals': '年終總決賽',
  'World Superseries Premier': '超級系列賽 Premier',
  'World Superseries': '超級系列賽',
  'Grand Prix Gold': '黃金大獎賽',
  'Grand Prix': '大獎賽',
  'Grade 1 – Individual Tournaments': '一級個人賽',
  'Grade 1 - Individual Tournaments': '一級個人賽',
}

export const normalizeTier = (tier: string) => {
  const trimmed = tier.trim()
  return TIER_ALIASES[trimmed] ?? trimmed
}

export type AcceptedMatch = {
  matchId: string
  playedOn: string
  discipline: 'MS' | 'WS'
  tournament: string
  tier: string
  round: string
  location: string
  eventId: string
  sourceTeam1Id: string
  sourceTeam2Id: string
  sourceTeam1Name: string
  sourceTeam2Name: string
  sideAId: string
  sideBId: string
  sideAName: string
  sideBName: string
  games: ScoredGame[]
  matchLegal: boolean
  game1Legal: boolean
  sideAWonMatch: boolean | null
  sideAWonGame1: boolean | null
  winnerConflict: boolean
}

export const matchPairKey = (playedOn: string, discipline: string, leftId: string, rightId: string) =>
  `${playedOn}|${discipline}|${[leftId, rightId].sort().join('|')}`

export const playerIdentity = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  const matched = trimmed.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  if (matched?.[1] && matched[2]) {
    return { id: matched[2].trim(), name: matched[1].trim() }
  }
  return { id: trimmed, name: trimmed }
}

export const parseGames = (score: string, swap: boolean) => {
  const parts = score.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 1 || parts.length > 3) return null

  const games: ScoredGame[] = []
  for (const part of parts) {
    const matched = part.match(/^(\d+)-(\d+)$/)
    if (!matched?.[1] || !matched[2]) return null
    const team1Points = Number(matched[1])
    const team2Points = Number(matched[2])
    const pointsA = swap ? team2Points : team1Points
    const pointsB = swap ? team1Points : team2Points
    games.push({
      pointsA,
      pointsB,
      sideAWon: pointsA > pointsB,
      isLegal: isLegalGame(pointsA, pointsB),
    })
  }

  return games
}

export const parseCsvRow = (row: CsvRow): { match: AcceptedMatch } | { reason: RejectReason } => {
  const playedOn = (row.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) return { reason: 'bad_date' }
  if (playedOn >= CUTOFF_DATE) return { reason: 'out_of_range' }

  const discipline = (row.discipline ?? '').trim()
  if (discipline !== 'MS' && discipline !== 'WS') return { reason: 'bad_discipline' }

  const winner = (row.winner ?? '').trim()
  if (winner !== '1' && winner !== '2') return { reason: 'missing_winner' }

  const team1 = playerIdentity(row.team1 ?? '')
  const team2 = playerIdentity(row.team2 ?? '')
  if (!team1.id || !team2.id) return { reason: 'missing_name' }
  if (team1.id === team2.id) return { reason: 'same_player' }

  const sideAIsTeam1 = team1.id < team2.id
  const games = parseGames(row.score ?? '', !sideAIsTeam1)
  if (!games) return { reason: 'bad_score' }

  const assessed = assessMatch(games)
  const team1Won = winner === '1'
  const sideAWonColumn = sideAIsTeam1 ? team1Won : !team1Won
  const winnerConflict = assessed.matchLegal && assessed.sideAWonMatch !== sideAWonColumn
  const matchLegal = assessed.matchLegal && !winnerConflict
  const sideAWonMatch = matchLegal ? assessed.sideAWonMatch : null

  if (!matchLegal && !assessed.game1Legal) return { reason: 'not_in_sample' }

  const sideA = sideAIsTeam1 ? team1 : team2
  const sideB = sideAIsTeam1 ? team2 : team1
  const tournament = (row.tournament ?? '').trim()
  const round = (row.round ?? '').trim()
  const year = playedOn.slice(0, 4)

  return {
    match: {
      matchId: [playedOn, discipline, tournament, round, sideA.id, sideB.id].join('|'),
      playedOn,
      discipline,
      tournament,
      tier: normalizeTier(row.tier ?? ''),
      round,
      location: (row.host_location ?? '').trim(),
      eventId: `${year}|${tournament}`,
      sourceTeam1Id: team1.id,
      sourceTeam2Id: team2.id,
      sourceTeam1Name: team1.name,
      sourceTeam2Name: team2.name,
      sideAId: sideA.id,
      sideBId: sideB.id,
      sideAName: sideA.name,
      sideBName: sideB.name,
      games,
      matchLegal,
      game1Legal: assessed.game1Legal,
      sideAWonMatch,
      sideAWonGame1: assessed.sideAWonGame1,
      winnerConflict,
    },
  }
}
