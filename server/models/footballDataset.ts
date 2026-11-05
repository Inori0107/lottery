/**
 * 足球歷史賽果解析。
 * 來源為台灣運彩版 StatsHub（sport/1）。
 */

import type { FootballDiscipline } from '../../shared/sports'

export type FootballCsvRow = {
  date?: string
  discipline?: string
  tournament?: string
  tier?: string
  round?: string
  team1?: string
  team2?: string
  winner?: string
  score?: string
  team1_home?: string
  half_time_score?: string
}

export type RejectReason =
  | 'bad_date'
  | 'out_of_range'
  | 'bad_discipline'
  | 'missing_result'
  | 'missing_name'
  | 'same_team'
  | 'bad_score'
  | 'not_in_sample'

export type AcceptedFootballMatch = {
  matchId: string
  playedOn: string
  discipline: FootballDiscipline
  tournament: string
  tier: string
  round: string
  eventId: string
  sourceTeam1Id: string
  sourceTeam2Id: string
  sourceTeam1Name: string
  sourceTeam2Name: string
  sideAId: string
  sideBId: string
  sideAName: string
  sideBName: string
  goalsA: number
  goalsB: number
  halfTimeGoalsA: number | null
  halfTimeGoalsB: number | null
  matchLegal: boolean
  sideAWonMatch: boolean | null
  isDraw: boolean
  sideAIsHome: boolean
}

const CUTOFF_DATE = '2027-01-01'

const TIER_ALIASES: Record<string, string> = {
  'English Premier League': '英超',
  'Spanish La Liga': '西甲',
  'German Bundesliga': '德甲',
  'Italian Serie A': '義甲',
  'French Ligue 1': '法甲',
  'UEFA Champions League': '歐冠',
  'UEFA Europa League': '歐聯',
  'FIFA World Cup': '世界盃',
}

export const normalizeTier = (tier: string) => {
  const trimmed = tier.trim()
  return TIER_ALIASES[trimmed] ?? trimmed
}

export const matchPairKey = (playedOn: string, discipline: string, leftId: string, rightId: string) =>
  `${playedOn}|${discipline}|${[leftId, rightId].sort().join('|')}`

export const teamIdentity = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  const matched = trimmed.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  if (matched?.[1] && matched[2]) {
    return { id: matched[2].trim(), name: matched[1].trim() }
  }
  return { id: trimmed, name: trimmed }
}

export const parseFootballScore = (score: string): { goalsA: number, goalsB: number } | null => {
  const matched = score.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!matched?.[1] || !matched[2]) return null
  return { goalsA: Number(matched[1]), goalsB: Number(matched[2]) }
}

export const parseFootballCsvRow = (
  row: FootballCsvRow
): { match: AcceptedFootballMatch } | { reason: RejectReason } => {
  const playedOn = (row.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) return { reason: 'bad_date' }
  if (playedOn >= CUTOFF_DATE) return { reason: 'out_of_range' }

  const discipline = (row.discipline ?? '').trim()
  if (discipline !== 'FM' && discipline !== 'FW') return { reason: 'bad_discipline' }

  const winner = (row.winner ?? '').trim()
  if (winner !== '1' && winner !== '2' && winner !== 'D') return { reason: 'missing_result' }

  const team1 = teamIdentity(row.team1 ?? '')
  const team2 = teamIdentity(row.team2 ?? '')
  if (!team1.id || !team2.id) return { reason: 'missing_name' }
  if (team1.id === team2.id) return { reason: 'same_team' }

  const parsedScore = parseFootballScore(row.score ?? '')
  if (!parsedScore) return { reason: 'bad_score' }

  const { goalsA: team1Goals, goalsB: team2Goals } = parsedScore

  const team1Won = winner === '1'
  const team2Won = winner === '2'
  const isDraw = winner === 'D'

  const scoreConflict = (
    (team1Won && team1Goals <= team2Goals) ||
    (team2Won && team2Goals <= team1Goals) ||
    (isDraw && team1Goals !== team2Goals)
  )
  if (scoreConflict) return { reason: 'bad_score' }

  const sideAIsTeam1 = team1.id < team2.id
  const goalsA = sideAIsTeam1 ? team1Goals : team2Goals
  const goalsB = sideAIsTeam1 ? team2Goals : team1Goals

  let halfTimeGoalsA: number | null = null
  let halfTimeGoalsB: number | null = null
  if (row.half_time_score) {
    const htScore = parseFootballScore(row.half_time_score)
    if (htScore) {
      halfTimeGoalsA = sideAIsTeam1 ? htScore.goalsA : htScore.goalsB
      halfTimeGoalsB = sideAIsTeam1 ? htScore.goalsB : htScore.goalsA
    }
  }

  const sideAWonMatch = isDraw ? null : (sideAIsTeam1 ? team1Won : team2Won)

  const sideA = sideAIsTeam1 ? team1 : team2
  const sideB = sideAIsTeam1 ? team2 : team1
  const tournament = (row.tournament ?? '').trim()
  const round = (row.round ?? '').trim()
  const year = playedOn.slice(0, 4)

  const team1IsHome = row.team1_home === '1' || row.team1_home === 'true'
  const sideAIsHome = sideAIsTeam1 ? team1IsHome : !team1IsHome

  return {
    match: {
      matchId: [playedOn, discipline, tournament, round, sideA.id, sideB.id].join('|'),
      playedOn,
      discipline,
      tournament,
      tier: normalizeTier(row.tier ?? ''),
      round,
      eventId: `${year}|${tournament}`,
      sourceTeam1Id: team1.id,
      sourceTeam2Id: team2.id,
      sourceTeam1Name: team1.name,
      sourceTeam2Name: team2.name,
      sideAId: sideA.id,
      sideBId: sideB.id,
      sideAName: sideA.name,
      sideBName: sideB.name,
      goalsA,
      goalsB,
      halfTimeGoalsA,
      halfTimeGoalsB,
      matchLegal: true,
      sideAWonMatch,
      isDraw,
      sideAIsHome,
    },
  }
}

export const footballDiscipline = (tournament: string): FootballDiscipline | null => {
  const lower = tournament.toLowerCase()
  if (lower.includes('女') || lower.includes('women') || lower.includes("women's")) return 'FW'
  if (lower.includes('男') || lower.includes('men') || lower.includes("men's")) return 'FM'
  return 'FM'
}
