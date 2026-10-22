import type { Discipline, PlayerOption } from '../../shared/types'
import { nameMatchClause, nameMatchParams, nameTokens } from '../utils/nameSearch'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const discipline: Discipline = query.discipline === 'WS' ? 'WS' : 'MS'
  const tokens = nameTokens(String(query.q ?? ''))
  const { sqlite } = useDb()
  const sql = `
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.game1_count, r.last_played_on
    FROM player_ratings r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.discipline = ?
      ${tokens.length > 0 ? `AND ${nameMatchClause('p.name_primary', tokens)}` : ''}
    ORDER BY r.match_count DESC, p.name_primary
    LIMIT 15
  `
  const rows = sqlite.prepare(sql).all(discipline, ...nameMatchParams(tokens)) as Array<{
    player_id: string
    name_primary: string
    elo: number
    match_count: number
    game1_count: number
    last_played_on: string | null
  }>

  return rows.map((row): PlayerOption => ({
    id: row.player_id,
    name: row.name_primary,
    elo: row.elo,
    matchCount: row.match_count,
    set1Count: row.game1_count,
    lastPlayedOn: row.last_played_on,
  }))
})
