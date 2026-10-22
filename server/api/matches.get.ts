import type { Discipline } from '../../shared/types'
import { nameMatchClause, nameMatchParams, nameTokens } from '../utils/nameSearch'

type MatchRow = {
  match_id: string
  discipline: Discipline
  round: string
  played_on: string
  side_a_won_match: number | null
  include_match: number
  event_name: string
  tier: string
  side_a_name: string
  side_b_name: string
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const discipline = query.discipline === 'MS' || query.discipline === 'WS' ? query.discipline : ''
  const from = String(query.from ?? '')
  const to = String(query.to ?? '')
  const tokens = nameTokens(String(query.q ?? ''))
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const pageSize = 30
  const filters = ['1 = 1']
  const params: Array<string | number> = []

  if (discipline) {
    filters.push('m.discipline = ?')
    params.push(discipline)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    filters.push('m.played_on >= ?')
    params.push(from)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    filters.push('m.played_on <= ?')
    params.push(to)
  }
  if (tokens.length > 0) {
    filters.push(`((${nameMatchClause('pa.name_primary', tokens)}) OR (${nameMatchClause('pb.name_primary', tokens)}))`)
    params.push(...nameMatchParams(tokens), ...nameMatchParams(tokens))
  }

  const where = filters.join(' AND ')
  const { sqlite } = useDb()
  const total = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM matches m
    JOIN players pa ON pa.player_id = m.side_a_id
    JOIN players pb ON pb.player_id = m.side_b_id
    WHERE ${where}
  `).get(...params) as { total: number }

  const rows = sqlite.prepare(`
    SELECT m.match_id, m.discipline, m.round, m.played_on, m.side_a_won_match, m.include_match,
           e.name AS event_name, e.tier,
           pa.name_primary AS side_a_name, pb.name_primary AS side_b_name
    FROM matches m
    JOIN events e ON e.event_id = m.event_id
    JOIN players pa ON pa.player_id = m.side_a_id
    JOIN players pb ON pb.player_id = m.side_b_id
    WHERE ${where}
    ORDER BY m.played_on DESC, m.match_id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize) as MatchRow[]

  const scoreStatement = sqlite.prepare(`
    SELECT points_a, points_b FROM games WHERE match_id = ? ORDER BY game_number
  `)
  const matches = rows.map((row) => {
    const games = scoreStatement.all(row.match_id) as Array<{ points_a: number, points_b: number }>
    return {
      id: row.match_id,
      discipline: row.discipline,
      round: row.round,
      playedOn: row.played_on,
      eventName: row.event_name,
      tier: row.tier,
      sideAName: row.side_a_name,
      sideBName: row.side_b_name,
      sideAWon: row.include_match === 1 && row.side_a_won_match !== null ? row.side_a_won_match === 1 : null,
      score: games.map(game => `${game.points_a}-${game.points_b}`).join(' '),
    }
  })

  return {
    page,
    pageSize,
    total: total.total,
    matches,
  }
})
