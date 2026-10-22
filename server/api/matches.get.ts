import type { Discipline, Sport } from '../../shared/types'
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

const emptyResult = (page: number, pageSize: number) => ({
  page,
  pageSize,
  total: 0,
  matches: [] as Array<{
    id: string
    discipline: Discipline
    round: string
    playedOn: string
    eventName: string
    tier: string
    sideAName: string
    sideBName: string
    sideAWon: boolean | null
    score: string
  }>,
})

const tableExists = (sqlite: ReturnType<typeof useDb>['sqlite'], name: string) =>
  Boolean(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name))

const allowedDiscipline = (sport: Sport, value: unknown): Discipline | '' => {
  if (sport === 'badminton' && (value === 'MS' || value === 'WS')) return value
  if (sport === 'volleyball' && (value === 'M' || value === 'W')) return value
  if (sport === 'tennis' && (value === 'ATP' || value === 'WTA')) return value
  return ''
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const sport: Sport = query.sport === 'volleyball' || query.sport === 'tennis' ? query.sport : 'badminton'
  const discipline = allowedDiscipline(sport, query.discipline)
  const from = String(query.from ?? '')
  const to = String(query.to ?? '')
  const tokens = nameTokens(String(query.q ?? ''))
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const pageSize = 30
  const { sqlite } = useDb()

  if (sport === 'volleyball') {
    if (!tableExists(sqlite, 'volleyball_matches') || !tableExists(sqlite, 'volleyball_teams')) {
      return emptyResult(page, pageSize)
    }
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
      filters.push(`((${nameMatchClause('ta.name_primary', tokens)}) OR (${nameMatchClause('tb.name_primary', tokens)}))`)
      params.push(...nameMatchParams(tokens), ...nameMatchParams(tokens))
    }
    const where = filters.join(' AND ')
    const total = sqlite.prepare(`
      SELECT COUNT(*) AS total
      FROM volleyball_matches m
      JOIN volleyball_teams ta ON ta.team_id = m.side_a_id
      JOIN volleyball_teams tb ON tb.team_id = m.side_b_id
      WHERE ${where}
    `).get(...params) as { total: number }
    const rows = sqlite.prepare(`
      SELECT m.match_id, m.discipline, '' AS round, m.played_on, NULL AS side_a_won_match, m.include_match,
             m.tournament AS event_name, '' AS tier,
             ta.name_primary AS side_a_name, tb.name_primary AS side_b_name
      FROM volleyball_matches m
      JOIN volleyball_teams ta ON ta.team_id = m.side_a_id
      JOIN volleyball_teams tb ON tb.team_id = m.side_b_id
      WHERE ${where}
      ORDER BY m.played_on DESC, m.match_id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as MatchRow[]
    return {
      page,
      pageSize,
      total: total.total,
      matches: rows.map(row => ({
        id: row.match_id,
        discipline: row.discipline,
        round: row.round,
        playedOn: row.played_on,
        eventName: row.event_name,
        tier: row.tier,
        sideAName: row.side_a_name,
        sideBName: row.side_b_name,
        sideAWon: null,
        score: '',
      })),
    }
  }

  if (sport === 'tennis') {
    if (!tableExists(sqlite, 'tennis_matches') || !tableExists(sqlite, 'tennis_players')) {
      return emptyResult(page, pageSize)
    }
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
    const total = sqlite.prepare(`
      SELECT COUNT(*) AS total
      FROM tennis_matches m
      JOIN tennis_players pa ON pa.player_id = m.side_a_id
      JOIN tennis_players pb ON pb.player_id = m.side_b_id
      WHERE ${where}
    `).get(...params) as { total: number }
    const rows = sqlite.prepare(`
      SELECT m.match_id, m.discipline, '' AS round, m.played_on, m.side_a_won_match, m.include_match,
             m.tournament AS event_name, '' AS tier,
             pa.name_primary AS side_a_name, pb.name_primary AS side_b_name
      FROM tennis_matches m
      JOIN tennis_players pa ON pa.player_id = m.side_a_id
      JOIN tennis_players pb ON pb.player_id = m.side_b_id
      WHERE ${where}
      ORDER BY m.played_on DESC, m.match_id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as MatchRow[]
    const scoreStatement = tableExists(sqlite, 'tennis_sets')
      ? sqlite.prepare(`SELECT games_a, games_b FROM tennis_sets WHERE match_id = ? ORDER BY set_number`)
      : null
    return {
      page,
      pageSize,
      total: total.total,
      matches: rows.map((row) => {
        const sets = scoreStatement
          ? scoreStatement.all(row.match_id) as Array<{ games_a: number, games_b: number }>
          : []
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
          score: sets.map(set => `${set.games_a}-${set.games_b}`).join(' '),
        }
      }),
    }
  }

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
