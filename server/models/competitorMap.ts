import type Database from 'better-sqlite3'
import type { Discipline, Sport } from '../../shared/types'
import { getSportForDiscipline } from '../../shared/sports'
import { existingColumn, tableExists as sqliteTableExists } from '../db/columns'

type Sqlite = Database.Database

export type MatchConfidence = 'confirmed' | 'pending'
export type CompetitorSide = 'away' | 'home'
export type CompetitorSource = 'sportradar' | 'tsl-event'

export type SideResolveInput = {
  sport: Sport
  discipline: Discipline
  tslEventId: string
  side: CompetitorSide
  sportradarUid: number | null
  names: string[]
  existingPlayerId: string | null
  existingStatus: MatchConfidence | null
}

export type SideResolveResult = {
  playerId: string | null
  suggestedId: string | null
  status: MatchConfidence
  reason: string
}

export type KnownIds = {
  byId: Set<string>
  exactName: Map<string, string>
}

const tslEventKey = (tslEventId: string, side: CompetitorSide) => `${tslEventId}:${side}`

const sportradarIds = (uid: number) => [String(uid), `sportradar:${uid}`]

export const ensureCompetitorMap = (ledger: Sqlite) => {
  ledger.exec(`
    CREATE TABLE IF NOT EXISTS competitor_map (
      sport TEXT NOT NULL,
      discipline TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (sport, discipline, source, source_id)
    )
  `)
}

const readMap = (
  ledger: Sqlite,
  sport: Sport,
  discipline: Discipline,
  source: CompetitorSource,
  sourceId: string,
) => {
  if (!sqliteTableExists(ledger, 'competitor_map')) return null
  return ledger.prepare(`
    SELECT player_id, confidence FROM competitor_map
    WHERE sport = ? AND discipline = ? AND source = ? AND source_id = ?
  `).get(sport, discipline, source, sourceId) as { player_id: string, confidence: MatchConfidence } | undefined
}

export const upsertCompetitorMap = (
  ledger: Sqlite,
  row: {
    sport: Sport
    discipline: Discipline
    source: CompetitorSource
    sourceId: string
    playerId: string
    displayName?: string
    confidence: MatchConfidence
    updatedAt?: string
  },
) => {
  ensureCompetitorMap(ledger)
  ledger.prepare(`
    INSERT INTO competitor_map (
      sport, discipline, source, source_id, player_id, display_name, confidence, updated_at
    ) VALUES (
      @sport, @discipline, @source, @sourceId, @playerId, @displayName, @confidence, @updatedAt
    )
    ON CONFLICT (sport, discipline, source, source_id) DO UPDATE SET
      player_id = excluded.player_id,
      display_name = excluded.display_name,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `).run({
    sport: row.sport,
    discipline: row.discipline,
    source: row.source,
    sourceId: row.sourceId,
    playerId: row.playerId,
    displayName: row.displayName ?? '',
    confidence: row.confidence,
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  })
}

export const loadKnownIds = (
  mainSqlite: Sqlite | null,
  discipline: Discipline,
): KnownIds => {
  const empty: KnownIds = { byId: new Set(), exactName: new Map() }
  if (!mainSqlite) return empty

  const sport = getSportForDiscipline(discipline)
  const query = sport === 'volleyball'
    ? {
      ratings: 'volleyball_team_ratings',
      names: 'volleyball_teams',
      id: 'team_id',
    }
    : sport === 'tennis'
      ? {
        ratings: 'tennis_player_ratings',
        names: 'tennis_players',
        id: 'player_id',
      }
      : {
        ratings: 'player_ratings',
        names: 'players',
        id: 'player_id',
      }

  if (!sqliteTableExists(mainSqlite, query.ratings) || !sqliteTableExists(mainSqlite, query.names)) return empty
  const rows = mainSqlite.prepare(`
    SELECT r."${query.id}" AS id, n.name_primary AS name
    FROM ${query.ratings} r
    JOIN ${query.names} n ON n."${query.id}" = r."${query.id}"
    WHERE r.discipline = ?
  `).all(discipline) as Array<{ id: string, name: string }>

  const byId = new Set(rows.map(row => row.id))
  const exactName = new Map<string, string>()
  const grouped = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = row.name.trim().replace(/\s+/g, ' ')
    if (!key) continue
    const ids = grouped.get(key) ?? new Set<string>()
    ids.add(row.id)
    grouped.set(key, ids)
  }
  for (const [name, ids] of grouped) {
    if (ids.size === 1) {
      const id = [...ids][0]
      if (id) exactName.set(name, id)
    }
  }
  return { byId, exactName }
}

const playerIdForUid = (uid: number, known: KnownIds) =>
  sportradarIds(uid).find(id => known.byId.has(id)) ?? null

const exactNameSuggestion = (names: string[], known: KnownIds) => {
  const hits = new Set<string>()
  for (const name of names) {
    const key = name.trim().replace(/\s+/g, ' ')
    const id = known.exactName.get(key)
    if (id) hits.add(id)
  }
  return hits.size === 1 ? [...hits][0]! : null
}

export const resolveCompetitorSide = (
  ledger: Sqlite,
  known: KnownIds,
  input: SideResolveInput,
): SideResolveResult => {
  const sport = input.sport
  if (input.existingStatus === 'confirmed' && input.existingPlayerId && known.byId.has(input.existingPlayerId)) {
    return {
      playerId: input.existingPlayerId,
      suggestedId: input.existingPlayerId,
      status: 'confirmed',
      reason: '先前已確認的對應',
    }
  }

  const tslMapped = readMap(ledger, sport, input.discipline, 'tsl-event', tslEventKey(input.tslEventId, input.side))
  if (tslMapped?.confidence === 'confirmed' && known.byId.has(tslMapped.player_id)) {
    return {
      playerId: tslMapped.player_id,
      suggestedId: tslMapped.player_id,
      status: 'confirmed',
      reason: '運彩場次 ID 對應表',
    }
  }

  if (input.sportradarUid !== null) {
    const srMapped = readMap(ledger, sport, input.discipline, 'sportradar', String(input.sportradarUid))
    if (srMapped?.confidence === 'confirmed' && known.byId.has(srMapped.player_id)) {
      return {
        playerId: srMapped.player_id,
        suggestedId: srMapped.player_id,
        status: 'confirmed',
        reason: 'Sportradar 選手 ID 對應表',
      }
    }
    const byUid = playerIdForUid(input.sportradarUid, known)
    if (byUid) {
      return {
        playerId: byUid,
        suggestedId: byUid,
        status: 'confirmed',
        reason: 'Sportradar 選手 ID',
      }
    }
  }

  const suggested = exactNameSuggestion(input.names, known)
  return {
    playerId: null,
    suggestedId: suggested,
    status: 'pending',
    reason: suggested ? '僅有姓名完全相符，待確認' : '沒有可靠的 ID 對應',
  }
}

export const confirmCompetitorSide = (
  ledger: Sqlite,
  input: {
    sport: Sport
    discipline: Discipline
    tslEventId: string
    side: CompetitorSide
    playerId: string
    sportradarUid: number | null
    displayName: string
  },
) => {
  const updatedAt = new Date().toISOString()
  upsertCompetitorMap(ledger, {
    sport: input.sport,
    discipline: input.discipline,
    source: 'tsl-event',
    sourceId: tslEventKey(input.tslEventId, input.side),
    playerId: input.playerId,
    displayName: input.displayName,
    confidence: 'confirmed',
    updatedAt,
  })
  if (input.sportradarUid !== null) {
    upsertCompetitorMap(ledger, {
      sport: input.sport,
      discipline: input.discipline,
      source: 'sportradar',
      sourceId: String(input.sportradarUid),
      playerId: input.playerId,
      displayName: input.displayName,
      confidence: 'confirmed',
      updatedAt,
    })
  }
}

export const fixtureMatchColumn = (sqlite: Sqlite, name: string) =>
  Boolean(existingColumn(sqlite, 'fixtures', [name]))
