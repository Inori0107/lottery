import type { Discipline, TeamOption } from '../../../shared/types'
import { nameMatchClause, nameMatchParams, nameTokens } from '../../utils/nameSearch'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const discipline: Discipline = query.discipline === 'W' ? 'W' : 'M'
  const tokens = nameTokens(String(query.q ?? ''))
  const { sqlite } = useDb()

  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='volleyball_team_ratings'
  `).get()

  if (!tableExists) {
    return []
  }

  const sql = `
    SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.home_advantage, r.roster_strength
    FROM volleyball_team_ratings r
    JOIN volleyball_teams t ON t.team_id = r.team_id
    WHERE r.discipline = ?
      ${tokens.length > 0 ? `AND ${nameMatchClause('t.name_primary', tokens)}` : ''}
    ORDER BY r.match_count DESC, t.name_primary
    LIMIT 15
  `
  const rows = sqlite.prepare(sql).all(discipline, ...nameMatchParams(tokens)) as Array<{
    team_id: string
    name_primary: string
    elo: number
    match_count: number
    set1_count: number
    last_played_on: string | null
    home_advantage: number
    roster_strength: number
  }>

  return rows.map((row): TeamOption => ({
    id: row.team_id,
    name: row.name_primary,
    elo: row.elo,
    matchCount: row.match_count,
    set1Count: row.set1_count,
    lastPlayedOn: row.last_played_on,
    homeAdvantage: row.home_advantage,
    rosterStrength: row.roster_strength,
  }))
})
