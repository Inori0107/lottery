import { z } from 'zod'
import type { TeamOption, FootballDiscipline } from '../../../shared/types'

const querySchema = z.object({
  discipline: z.enum(['FM', 'FW']),
  search: z.string().optional(),
})

type TeamRow = {
  team_id: string
  name_primary: string
  elo: number
  match_count: number
  set1_count: number
  last_played_on: string | null
  home_advantage: number
}

export default defineEventHandler((event): TeamOption[] => {
  const query = querySchema.safeParse(getQuery(event))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: '請提供項目（FM 或 FW）' })
  }

  const { sqlite } = useDb()
  const discipline = query.data.discipline as FootballDiscipline
  const search = query.data.search?.trim().toLowerCase() ?? ''

  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='football_team_ratings'
  `).get()

  if (!tableExists) {
    return []
  }

  let rows: TeamRow[]
  if (search) {
    rows = sqlite.prepare(`
      SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.home_advantage
      FROM football_team_ratings r
      JOIN football_teams t ON t.team_id = r.team_id
      WHERE r.discipline = ? AND (
        LOWER(t.name_primary) LIKE ? OR
        LOWER(t.name_aliases) LIKE ? OR
        LOWER(r.team_id) LIKE ?
      )
      ORDER BY r.match_count DESC, r.elo DESC
      LIMIT 50
    `).all(discipline, `%${search}%`, `%${search}%`, `%${search}%`) as TeamRow[]
  } else {
    rows = sqlite.prepare(`
      SELECT r.team_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on, r.home_advantage
      FROM football_team_ratings r
      JOIN football_teams t ON t.team_id = r.team_id
      WHERE r.discipline = ?
      ORDER BY r.match_count DESC, r.elo DESC
      LIMIT 100
    `).all(discipline) as TeamRow[]
  }

  return rows.map(row => ({
    id: row.team_id,
    name: row.name_primary,
    elo: row.elo,
    matchCount: row.match_count,
    set1Count: row.set1_count,
    lastPlayedOn: row.last_played_on,
    homeAdvantage: row.home_advantage,
    rosterStrength: 1.0,
  }))
})
