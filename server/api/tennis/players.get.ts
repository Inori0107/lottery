import type { Discipline, PlayerOption } from "../../../shared/types";
import { nameMatchClause, nameMatchParams, nameTokens } from "../../utils/nameSearch";

export default defineEventHandler((event) => {
	const query = getQuery(event);
	const discipline: Discipline = query.discipline === "WTA" ? "WTA" : "ATP";
	const tokens = nameTokens(String(query.q ?? ""));
	const { sqlite } = useDb();
	const table = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tennis_player_ratings'`).get();
	if (!table) return [];
	const sql = `
    SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on
    FROM tennis_player_ratings r
    JOIN tennis_players p ON p.player_id = r.player_id
    WHERE r.discipline = ?
      ${tokens.length > 0 ? `AND ${nameMatchClause("p.name_primary", tokens)}` : ""}
    ORDER BY r.match_count DESC, p.name_primary
    LIMIT 15
  `;
	const rows = sqlite.prepare(sql).all(discipline, ...nameMatchParams(tokens)) as Array<{
		player_id: string;
		name_primary: string;
		elo: number;
		match_count: number;
		set1_count: number;
		last_played_on: string | null;
	}>;

	return rows.map(
		(row): PlayerOption => ({
			id: row.player_id,
			name: row.name_primary,
			elo: row.elo,
			matchCount: row.match_count,
			set1Count: row.set1_count,
			lastPlayedOn: row.last_played_on
		})
	);
});
