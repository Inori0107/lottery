/**
 * 排球資料集處理模組
 * 
 * 資料來源說明：
 * 1. 台灣運彩（TSL）即時賽事與賠率：透過運彩頁書籤小工具匯入
 * 2. Sportradar StatsHub：提供賽果與選手資訊
 * 
 * 歷史資料來源（訓練/回測用）：
 * - 目前使用 volleyball-world.com API 或類似公開資料
 * - 支援 FIVB 國家隊賽事與職業聯賽
 * 
 * 資料限制：
 * - 歷史資料可能不完整，尤其是職業聯賽
 * - 陣容資訊可能不齊全，需要手動補充或估計
 * - 主場優勢依賽事類型不同（聯賽 vs 國際賽）
 */

import type { VolleyballDiscipline } from '../../shared/types'

export type VolleyballCsvRow = {
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
  team1_roster_strength?: string
  team2_roster_strength?: string
}

export type RejectReason =
  | 'bad_date'
  | 'out_of_range'
  | 'bad_discipline'
  | 'missing_winner'
  | 'missing_name'
  | 'same_team'
  | 'bad_score'
  | 'not_in_sample'

export type ScoredSet = {
  pointsA: number
  pointsB: number
  sideAWon: boolean
  isLegal: boolean
}

export type AcceptedVolleyballMatch = {
  matchId: string
  playedOn: string
  discipline: VolleyballDiscipline
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
  sets: ScoredSet[]
  matchLegal: boolean
  set1Legal: boolean
  sideAWonMatch: boolean | null
  sideAWonSet1: boolean | null
  sideAIsHome: boolean
  sideARosterStrength: number
  sideBRosterStrength: number
  winnerConflict: boolean
}

const CUTOFF_DATE = '2027-01-01'

const TIER_ALIASES: Record<string, string> = {
  'FIVB Volleyball Nations League': 'VNL',
  'FIVB World Championship': '世錦賽',
  'Olympic Games': '奧運',
  'CEV Champions League': '歐冠',
  'Italian SuperLega': '義甲',
  'Polish PlusLiga': '波蘭聯賽',
  'Turkish Efeler Ligi': '土超',
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

const isLegalSet = (pointsA: number, pointsB: number, isDecidingSet: boolean): boolean => {
  const targetPoints = isDecidingSet ? 15 : 25
  const high = Math.max(pointsA, pointsB)
  const low = Math.min(pointsA, pointsB)

  if (high < targetPoints) return false

  if (high === targetPoints && low <= targetPoints - 2) return true

  if (high > targetPoints) {
    return high - low === 2
  }

  return false
}

export const parseVolleyballSets = (score: string, swap: boolean): ScoredSet[] | null => {
  const parts = score.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 5) return null

  const sets: ScoredSet[] = []
  let winsA = 0
  let winsB = 0

  for (let i = 0; i < parts.length; i++) {
    const matched = parts[i]!.match(/^(\d+)-(\d+)$/)
    if (!matched?.[1] || !matched[2]) return null

    const team1Points = Number(matched[1])
    const team2Points = Number(matched[2])
    const pointsA = swap ? team2Points : team1Points
    const pointsB = swap ? team1Points : team2Points

    const isDecidingSet = (winsA === 2 && winsB === 2)
    const isLegal = isLegalSet(pointsA, pointsB, isDecidingSet)

    sets.push({
      pointsA,
      pointsB,
      sideAWon: pointsA > pointsB,
      isLegal,
    })

    if (pointsA > pointsB) winsA++
    else winsB++
  }

  return sets
}

const assessVolleyballMatch = (sets: ScoredSet[]) => {
  const set1 = sets[0]
  const set1Legal = set1?.isLegal ?? false
  const sideAWonSet1 = set1Legal ? (set1?.sideAWon ?? null) : null

  const winsA = sets.filter(s => s.sideAWon).length
  const winsB = sets.length - winsA
  const matchLegal = sets.every(s => s.isLegal) && (winsA === 3 || winsB === 3)
  const sideAWonMatch = matchLegal ? winsA === 3 : null

  return { matchLegal, set1Legal, sideAWonMatch, sideAWonSet1 }
}

export const parseVolleyballCsvRow = (
  row: VolleyballCsvRow
): { match: AcceptedVolleyballMatch } | { reason: RejectReason } => {
  const playedOn = (row.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) return { reason: 'bad_date' }
  if (playedOn >= CUTOFF_DATE) return { reason: 'out_of_range' }

  const discipline = (row.discipline ?? '').trim()
  if (discipline !== 'M' && discipline !== 'W') return { reason: 'bad_discipline' }

  const winner = (row.winner ?? '').trim()
  if (winner !== '1' && winner !== '2') return { reason: 'missing_winner' }

  const team1 = teamIdentity(row.team1 ?? '')
  const team2 = teamIdentity(row.team2 ?? '')
  if (!team1.id || !team2.id) return { reason: 'missing_name' }
  if (team1.id === team2.id) return { reason: 'same_team' }

  const sideAIsTeam1 = team1.id < team2.id
  const sets = parseVolleyballSets(row.score ?? '', !sideAIsTeam1)
  if (!sets) return { reason: 'bad_score' }

  const assessed = assessVolleyballMatch(sets)
  const team1Won = winner === '1'
  const sideAWonColumn = sideAIsTeam1 ? team1Won : !team1Won
  const winnerConflict = assessed.matchLegal && assessed.sideAWonMatch !== sideAWonColumn
  const matchLegal = assessed.matchLegal && !winnerConflict
  const sideAWonMatch = matchLegal ? assessed.sideAWonMatch : null

  if (!matchLegal && !assessed.set1Legal) return { reason: 'not_in_sample' }

  const sideA = sideAIsTeam1 ? team1 : team2
  const sideB = sideAIsTeam1 ? team2 : team1
  const tournament = (row.tournament ?? '').trim()
  const round = (row.round ?? '').trim()
  const year = playedOn.slice(0, 4)

  const team1IsHome = row.team1_home === '1' || row.team1_home === 'true'
  const sideAIsHome = sideAIsTeam1 ? team1IsHome : !team1IsHome

  const team1Roster = Number(row.team1_roster_strength) || 1.0
  const team2Roster = Number(row.team2_roster_strength) || 1.0
  const sideARosterStrength = sideAIsTeam1 ? team1Roster : team2Roster
  const sideBRosterStrength = sideAIsTeam1 ? team2Roster : team1Roster

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
      sets,
      matchLegal,
      set1Legal: assessed.set1Legal,
      sideAWonMatch,
      sideAWonSet1: assessed.sideAWonSet1,
      sideAIsHome,
      sideARosterStrength,
      sideBRosterStrength,
      winnerConflict,
    },
  }
}

export const volleyballDiscipline = (tournament: string): VolleyballDiscipline | null => {
  const lower = tournament.toLowerCase()
  if (lower.includes('女') || lower.includes('women') || lower.includes("women's")) return 'W'
  if (lower.includes('男') || lower.includes('men') || lower.includes("men's")) return 'M'
  return null
}
