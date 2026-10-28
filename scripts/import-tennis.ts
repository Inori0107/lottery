import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDatabase } from "../server/db/open";
import { TENNIS_SOURCE_URL } from "../server/models/constants";
import { parseStatshubPage, type StatshubMatch } from "../server/models/statshub";
import { parseTennisCsvRow, type TennisCsvRow } from "../server/models/tennisDataset";
import { runTennisBacktest, type TennisBacktestMatch } from "../server/models/tennisBacktest";
import { dbFile, tennisStatshubDir } from "./paths";

const toCsvRow = (match: StatshubMatch): TennisCsvRow => ({
	date: match.playedOn,
	discipline: match.discipline,
	tournament: match.tournament,
	round: match.round,
	player1: `${match.home.name.trim()} [sportradar:${match.home.uid}]`,
	player2: `${match.away.name.trim()} [sportradar:${match.away.uid}]`,
	winner: match.winner,
	score: match.score
});

const loadCachedMatches = () => {
	mkdirSync(tennisStatshubDir, { recursive: true });
	const files = readdirSync(tennisStatshubDir)
		.filter((file) => file.endsWith(".html"))
		.sort();
	const matches = new Map<number, StatshubMatch>();
	for (const file of files) {
		const page = parseStatshubPage(readFileSync(join(tennisStatshubDir, file), "utf8"), "tennis");
		for (const match of page.matches) {
			if (!match.played || (match.discipline !== "ATP" && match.discipline !== "WTA")) continue;
			matches.set(match.sportradarId, match);
		}
	}
	return [...matches.values()];
};

const matches = loadCachedMatches();
const rows = matches.map(toCsvRow);
const accepted = rows.map(parseTennisCsvRow).flatMap((result) => ("match" in result ? [result.match] : []));
if (accepted.length < 8) {
	throw new Error(`網球樣本太少：${accepted.length}（來源頁 ${matches.length} 場）。請先執行 npm run fetch:statshub`);
}

const backtestInput: TennisBacktestMatch[] = accepted.map((match) => ({
	matchId: match.matchId,
	discipline: match.discipline,
	tournament: match.tournament,
	playedOn: match.playedOn,
	sideAId: match.sideAId,
	sideBId: match.sideBId,
	includeMatch: match.matchLegal,
	includeSet1: match.set1Legal,
	sideAWonMatch: match.sideAWonMatch,
	sideAWonSet1: match.sideAWonSet1,
	sets: match.sets,
	bestOf: match.bestOf
}));

const results = runTennisBacktest(backtestInput);
mkdirSync(dirname(dbFile), { recursive: true });
const { sqlite } = openDatabase(dbFile);

const insertPlayer = sqlite.prepare(`
  INSERT INTO tennis_players (player_id, name_primary, name_aliases)
  VALUES (?, ?, '')
  ON CONFLICT (player_id) DO UPDATE SET
    name_primary = excluded.name_primary,
    name_aliases = CASE
      WHEN tennis_players.name_aliases = '' THEN excluded.name_primary
      WHEN instr(tennis_players.name_aliases, excluded.name_primary) THEN tennis_players.name_aliases
      ELSE tennis_players.name_aliases || '|' || excluded.name_primary
    END
`);
const insertMatch = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_matches (
    match_id, discipline, tournament, played_on, side_a_id, side_b_id, side_a_won_match, include_match, include_set1, source_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSet = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_sets (
    match_id, set_number, games_a, games_b, side_a_won, is_legal
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const insertRating = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_player_ratings (
    discipline, player_id, elo, match_count, set1_count, last_played_on, set1_recent
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertModel = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_model_state (discipline, model_version, set1_method, payload, data_through)
  VALUES (?, ?, ?, ?, ?)
`);

sqlite.transaction(() => {
	sqlite.prepare("DELETE FROM tennis_sets").run();
	sqlite.prepare("DELETE FROM tennis_matches").run();
	sqlite.prepare("DELETE FROM tennis_player_ratings").run();
	sqlite.prepare("DELETE FROM tennis_model_state").run();
	for (const match of accepted) {
		insertPlayer.run(match.sideAId, match.sideAName);
		insertPlayer.run(match.sideBId, match.sideBName);
		insertMatch.run(
			match.matchId,
			match.discipline,
			match.tournament,
			match.playedOn,
			match.sideAId,
			match.sideBId,
			match.sideAWonMatch === null ? null : Number(match.sideAWonMatch),
			Number(match.matchLegal),
			Number(match.set1Legal),
			TENNIS_SOURCE_URL
		);
		match.sets.forEach((set, index) => {
			insertSet.run(match.matchId, index + 1, set.gamesA, set.gamesB, Number(set.sideAWon), Number(set.isLegal));
		});
	}
	for (const model of results) {
		insertModel.run(model.discipline, model.modelVersion, model.set1Method, JSON.stringify(model.payload), model.dataThrough);
		for (const rating of model.ratings) {
			insertRating.run(
				rating.discipline,
				rating.playerId,
				rating.elo,
				rating.matchCount,
				rating.set1Count,
				rating.lastPlayedOn,
				JSON.stringify(rating.set1Recent)
			);
		}
	}
})();

console.log(
	`網球資料已寫入 ${dbFile}，比賽 ${accepted.length} 場，來源 ${TENNIS_SOURCE_URL}，模型 ${results.map((model) => `${model.discipline}:${model.ratings.length}`).join(", ")}`
);
