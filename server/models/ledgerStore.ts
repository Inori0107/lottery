import { quoteSelection } from '../../shared/quoteSelection';
import { verifyPrediction, readPrediction } from './predictionLedger';
import { conservativeEligibility, MAX_TICKET_FRACTION, MAX_DAILY_FRACTION } from '../../shared/strategy';
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
	BankrollRecord,
	BetAction,
	BetMarket,
	BetRecord,
	BetStatus,
	CorrectScore,
	Discipline,
	FixtureOdds,
	FixtureStatus,
	FixtureSummary,
	FixturesResponse,
	LedgerKind,
	Participant,
	Sport,
	TicketKind,
	TicketLeg,
	TicketLegInput,
	TicketRecord
} from "../../shared/types";
import { emptyFixtureOdds } from "../../shared/types";
import type { FixtureMarket } from "../../shared/types";
import { defaultFixtureOdds, marketIsOpen, MAX_ODDS_AGE_MS } from "../../shared/fixtureMarkets";
import { existingColumn, tableExists as sqliteTableExists } from "../db/columns";
import { DEFAULT_SIM_BANKROLL } from "../db/ledger";
import { TENNIS_INITIAL_ELO, VOLLEYBALL_INITIAL_ELO } from "./constants";
import { getSportForDiscipline, isTennisDiscipline, isVolleyballDiscipline, setsToWinFor } from "../../shared/sports";
import { canAfford, isParlayQuote, quoteParlay, resolveParlayTicket } from "../../shared/parlay";
import { betPayout, closingLineValue, closingOdds, formatGameScores, parseGameScores, settleBet, type OddsSnapshot } from "./settle";
import { resolveStatshubPlayer, splitStatshubName, type StatshubMatch } from "./statshub";
import { buildPlayerDirectory, foldPlayerName, type PlayerDirectory } from "./sun";
import type { TslFixture } from "./tsl";

type Sqlite = Database.Database;

export const taipeiDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);

export type PlayerLinker = (discipline: Discipline, names: string[], uid: number | null) => string | null;

const foldTeamName = (name: string) => foldPlayerName(name.replace(/\s+/g, " ").trim());

type TeamIndex = { byFolded: Map<string, string>; ids: Set<string> };

export const createPlayerLinker = (mainSqlite: Sqlite | null): PlayerLinker => {
	if (!mainSqlite) return () => null;
	const cache = new Map<Discipline, { directory: PlayerDirectory; ids: Set<string> }>();
	const tennisCache = new Map<Discipline, { directory: PlayerDirectory; ids: Set<string> }>();
	const teamCache = new Map<Discipline, TeamIndex>();
	const tableExists = (name: string) => Boolean(mainSqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name));

	const loadPlayers = (discipline: Discipline) => {
		const cached = cache.get(discipline);
		if (cached) return cached;
		const players = mainSqlite
			.prepare(
				`
      SELECT p.player_id AS id, p.name_primary AS name
      FROM player_ratings r
      JOIN players p ON p.player_id = r.player_id
      WHERE r.discipline = ?
    `
			)
			.all(discipline) as Array<{ id: string; name: string }>;
		const entry = { directory: buildPlayerDirectory(players), ids: new Set(players.map((player) => player.id)) };
		cache.set(discipline, entry);
		return entry;
	};

	const loadTennisPlayers = (discipline: Discipline) => {
		const cached = tennisCache.get(discipline);
		if (cached) return cached;
		if (!tableExists("tennis_player_ratings") || !tableExists("tennis_players")) {
			const empty = { directory: buildPlayerDirectory([]), ids: new Set<string>() };
			tennisCache.set(discipline, empty);
			return empty;
		}
		const players = mainSqlite
			.prepare(
				`
      SELECT p.player_id AS id, p.name_primary AS name
      FROM tennis_player_ratings r
      JOIN tennis_players p ON p.player_id = r.player_id
      WHERE r.discipline = ?
    `
			)
			.all(discipline) as Array<{ id: string; name: string }>;
		const entry = { directory: buildPlayerDirectory(players), ids: new Set(players.map((player) => player.id)) };
		tennisCache.set(discipline, entry);
		return entry;
	};

	const loadTeams = (discipline: Discipline): TeamIndex => {
		const cached = teamCache.get(discipline);
		if (cached) return cached;
		if (!tableExists("volleyball_team_ratings") || !tableExists("volleyball_teams")) {
			const empty = { byFolded: new Map<string, string>(), ids: new Set<string>() };
			teamCache.set(discipline, empty);
			return empty;
		}
		const teams = mainSqlite
			.prepare(
				`
      SELECT t.team_id AS id, t.name_primary AS name, t.name_aliases AS aliases
      FROM volleyball_team_ratings r
      JOIN volleyball_teams t ON t.team_id = r.team_id
      WHERE r.discipline = ?
    `
			)
			.all(discipline) as Array<{ id: string; name: string; aliases: string }>;
		const byFolded = new Map<string, string>();
		const ids = new Set<string>();
		for (const team of teams) {
			ids.add(team.id);
			byFolded.set(foldTeamName(team.name), team.id);
			byFolded.set(foldTeamName(team.id.replace(/^sportradar:/, "")), team.id);
			for (const alias of team.aliases
				.split("|")
				.map((value) => value.trim())
				.filter(Boolean)) {
				byFolded.set(foldTeamName(alias), team.id);
			}
		}
		const entry = { byFolded, ids };
		teamCache.set(discipline, entry);
		return entry;
	};

	const resolveTeam = (discipline: Discipline, names: string[], uid: number | null) => {
		const { byFolded, ids } = loadTeams(discipline);
		for (const name of names) {
			const id = byFolded.get(foldTeamName(name));
			if (id) return id;
		}
		if (uid === null) return null;
		const fallback = `sportradar:${uid}`;
		return ids.has(fallback) ? fallback : null;
	};

	return (discipline, names, uid) => {
		if (isVolleyballDiscipline(discipline)) return resolveTeam(discipline, names, uid);
		if (isTennisDiscipline(discipline)) {
			const primary = loadTennisPlayers(discipline);
			const linked = resolveStatshubPlayer(names, uid, primary.directory, primary.ids);
			if (linked) return linked;
			const other = discipline === "ATP" ? "WTA" : "ATP";
			const fallback = loadTennisPlayers(other);
			return resolveStatshubPlayer(names, uid, fallback.directory, fallback.ids) ?? null;
		}
		const { directory, ids } = loadPlayers(discipline);
		return resolveStatshubPlayer(names, uid, directory, ids) ?? null;
	};
};

type FixtureRow = {
	sportradar_id: number;
	tsl_event_id: string;
	sport: Sport | null;
	discipline: Discipline;
	tournament: string;
	starts_at: string;
	play_date: string;
	away_name: string;
	home_name: string;
	away_name_zh: string;
	home_name_zh: string;
	away_uid: number | null;
	home_uid: number | null;
	away_player_id: string | null;
	home_player_id: string | null;
	status: FixtureStatus;
	score: string;
	ignored_markets?: string;
};

export type ImportSummary = {
	marketStats: Record<FixtureMarket['status'], number>;
	fixtures: number;
	snapshots: number;
	unlinked: string[];
	sports: Record<Sport, number>;
};

export const importTslFixtures = (ledger: Sqlite, fixtures: TslFixture[], link: PlayerLinker, capturedAt: string): ImportSummary => {
	const marketStats = { available: 0, unavailable: 0, unsupported: 0, invalid: 0 };
	const saveMarkets = ledger.prepare('INSERT OR IGNORE INTO market_snapshots (fixture_id, captured_at, markets_json) VALUES (?, ?, ?)');
	const findFixture = ledger.prepare("SELECT * FROM fixtures WHERE sportradar_id = ?");
	const upsert = ledger.prepare(`
    INSERT INTO fixtures (
      sportradar_id, tsl_event_id, sport, discipline, tournament, starts_at, play_date,
      away_name, home_name, away_name_zh, home_name_zh, away_player_id, home_player_id, updated_at, ignored_markets
    ) VALUES (
      @sportradarId, @tslEventId, @sport, @discipline, @tournament, @startsAt, @playDate,
      @awayName, @homeName, @awayNameZh, @homeNameZh, @awayPlayerId, @homePlayerId, @updatedAt, @ignoredMarkets
    )
    ON CONFLICT (sportradar_id) DO UPDATE SET
      tsl_event_id = excluded.tsl_event_id,
      sport = excluded.sport,
      discipline = excluded.discipline,
      tournament = excluded.tournament,
      starts_at = excluded.starts_at,
      play_date = excluded.play_date,
      away_name = excluded.away_name,
      home_name = excluded.home_name,
      away_name_zh = excluded.away_name_zh,
      home_name_zh = excluded.home_name_zh,
      away_player_id = COALESCE(excluded.away_player_id, fixtures.away_player_id),
      home_player_id = COALESCE(excluded.home_player_id, fixtures.home_player_id),
      updated_at = excluded.updated_at,
      ignored_markets = excluded.ignored_markets
  `);
	const insertSnapshot = ledger.prepare(`
    INSERT OR IGNORE INTO odds_snapshots (fixture_id, market, outcome_key, line, odds, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

	const unlinked: string[] = [];
	const sports: Record<Sport, number> = { badminton: 0, volleyball: 0, tennis: 0 };
	let snapshots = 0;
	ledger.transaction(() => {
		for (const fixture of fixtures) {
			const latest = latestMarketSnapshot(ledger, fixture.sportradarId);
			if (latest && latest.capturedAt > capturedAt) continue;
			sports[fixture.sport] += 1;
			const existing = findFixture.get(fixture.sportradarId) as FixtureRow | undefined;
			const awayPlayerId = link(fixture.discipline, [fixture.awayName], existing?.away_uid ?? null);
			const homePlayerId = link(fixture.discipline, [fixture.homeName], existing?.home_uid ?? null);
			if (!awayPlayerId && !existing?.away_player_id) unlinked.push(fixture.awayName);
			if (!homePlayerId && !existing?.home_player_id) unlinked.push(fixture.homeName);
			upsert.run({
				...fixture,
				playDate: taipeiDate(new Date(fixture.startsAt)),
				awayPlayerId,
				homePlayerId,
				updatedAt: capturedAt,
				ignoredMarkets: JSON.stringify(fixture.ignoredMarkets)
			});
			if (fixture.markets) {
				const markets = fixture.markets.map(m => capturedAt >= fixture.startsAt && m.status === 'available'
					? { ...m, status: 'unavailable' as const, reason: '已開賽，不接受賽前模擬' } : m);
				for (const market of markets) marketStats[market.status] += 1;
				saveMarkets.run(fixture.sportradarId, capturedAt, JSON.stringify(markets));
			}
			if (capturedAt >= fixture.startsAt) continue;
			for (const row of fixture.rows) {
				snapshots += insertSnapshot.run(fixture.sportradarId, row.market, row.outcomeKey, row.line, row.odds, capturedAt).changes;
			}
		}
		ledger
			.prepare(
				`
      INSERT INTO ledger_state (key, value) VALUES ('last_tsl_import', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE excluded.value > ledger_state.value
    `
			)
			.run(capturedAt);
	})();
	return { fixtures: fixtures.length, snapshots, unlinked, sports, marketStats };
};

export const latestMarketSnapshot = (ledger: Sqlite, fixtureId: number) => {
	const row = ledger.prepare('SELECT captured_at, markets_json FROM market_snapshots WHERE fixture_id = ? ORDER BY captured_at DESC LIMIT 1').get(fixtureId) as { captured_at: string, markets_json: string } | undefined;
	return row ? { capturedAt: row.captured_at, markets: JSON.parse(row.markets_json) as FixtureMarket[] } : null;
};

const surnameKey = (name: string) => foldPlayerName(splitStatshubName(name).surname);

const sameOrientation = (match: StatshubMatch, awayName: string, homeName: string) => {
	const away = foldTeamName(awayName);
	const home = foldTeamName(homeName);
	const matchAway = foldTeamName(match.away.name);
	const matchHome = foldTeamName(match.home.name);
	if (matchAway === away || matchHome === home) return true;
	if (matchHome === away || matchAway === home) return false;
	const awaySurname = surnameKey(awayName);
	const homeSurname = surnameKey(homeName);
	if (surnameKey(match.away.name) === awaySurname || surnameKey(match.home.name) === homeSurname) return true;
	if (surnameKey(match.home.name) === awaySurname || surnameKey(match.away.name) === homeSurname) return false;
	return true;
};

export const applyStatshubResults = (ledger: Sqlite, matches: StatshubMatch[], link: PlayerLinker) => {
	const findFixture = ledger.prepare("SELECT * FROM fixtures WHERE sportradar_id = ?");
	const update = ledger.prepare(`
    UPDATE fixtures SET
      away_uid = @awayUid,
      home_uid = @homeUid,
      away_player_id = COALESCE(@awayPlayerId, away_player_id),
      home_player_id = COALESCE(@homePlayerId, home_player_id),
      status = @status,
      score = @score,
      updated_at = @updatedAt
    WHERE sportradar_id = @sportradarId
  `);
	const updatedAt = new Date().toISOString();
	let updated = 0;
	ledger.transaction(() => {
		for (const match of matches) {
			const fixture = findFixture.get(match.sportradarId) as FixtureRow | undefined;
			if (!fixture) continue;
			const aligned = sameOrientation(match, fixture.away_name, fixture.home_name);
			const awayTeam = aligned ? match.away : match.home;
			const homeTeam = aligned ? match.home : match.away;
			const games = match.games.map((game) => (aligned ? { away: game.away, home: game.home } : { away: game.home, home: game.away }));
			update.run({
				sportradarId: match.sportradarId,
				awayUid: awayTeam.uid,
				homeUid: homeTeam.uid,
				awayPlayerId: link(fixture.discipline, [fixture.away_name, awayTeam.name], awayTeam.uid),
				homePlayerId: link(fixture.discipline, [fixture.home_name, homeTeam.name], homeTeam.uid),
				status: match.status === "abandoned" ? "void" : match.status,
				score: formatGameScores(games),
				updatedAt
			});
			updated += 1;
		}
	})();
	return updated;
};

export const fixtureIdsNeedingMatchPage = (ledger: Sqlite, today: string, knownIds: Set<number>, limit = 50) => {
	const rows = ledger
		.prepare(
			`
    SELECT sportradar_id, status, away_player_id, home_player_id
    FROM fixtures
    WHERE play_date <= date(?, '+1 day') AND play_date >= date(?, '-7 day')
    ORDER BY CASE WHEN away_player_id IS NULL OR home_player_id IS NULL THEN 0 ELSE 1 END, starts_at
  `
		)
		.all(today, today) as Array<{
		sportradar_id: number;
		status: FixtureStatus;
		away_player_id: string | null;
		home_player_id: string | null;
	}>;
	return rows
		.filter((row) => {
			const unlinked = !row.away_player_id || !row.home_player_id;
			const missingScore = (row.status === "pre" || row.status === "live") && !knownIds.has(row.sportradar_id);
			return unlinked || missingScore;
		})
		.map((row) => row.sportradar_id)
		.slice(0, limit);
};

export const ensureTennisPlayersFromMatches = (mainSqlite: Sqlite, matches: StatshubMatch[]) => {
	if (!sqliteTableExists(mainSqlite, "tennis_players") || !sqliteTableExists(mainSqlite, "tennis_player_ratings")) return 0;
	const insertPlayer = mainSqlite.prepare(`
    INSERT INTO tennis_players (player_id, name_primary, name_aliases)
    VALUES (?, ?, '')
    ON CONFLICT (player_id) DO UPDATE SET
      name_aliases = CASE
        WHEN tennis_players.name_aliases = '' THEN excluded.name_primary
        WHEN instr(tennis_players.name_aliases, excluded.name_primary) THEN tennis_players.name_aliases
        ELSE tennis_players.name_aliases || '|' || excluded.name_primary
      END
  `);
	const hasRating = mainSqlite.prepare("SELECT 1 FROM tennis_player_ratings WHERE player_id = ? LIMIT 1");
	const insertRating = mainSqlite.prepare(`
    INSERT OR IGNORE INTO tennis_player_ratings (
      discipline, player_id, elo, match_count, set1_count, last_played_on, set1_recent
    ) VALUES (?, ?, ?, 0, 0, NULL, '[]')
  `);
	let added = 0;
	mainSqlite.transaction(() => {
		for (const match of matches) {
			if (!isTennisDiscipline(match.discipline)) continue;
			for (const team of [match.away, match.home]) {
				const playerId = `sportradar:${team.uid}`;
				insertPlayer.run(playerId, team.name.trim());
				if (hasRating.get(playerId)) continue;
				insertRating.run(match.discipline, playerId, TENNIS_INITIAL_ELO);
				added += 1;
			}
		}
	})();
	return added;
};

export const ensureVolleyballTeamsFromMatches = (mainSqlite: Sqlite, matches: StatshubMatch[]) => {
	if (!sqliteTableExists(mainSqlite, "volleyball_teams") || !sqliteTableExists(mainSqlite, "volleyball_team_ratings")) return 0;
	const insertTeam = mainSqlite.prepare(`
    INSERT INTO volleyball_teams (team_id, name_primary, name_aliases)
    VALUES (?, ?, '')
    ON CONFLICT (team_id) DO UPDATE SET
      name_aliases = CASE
        WHEN volleyball_teams.name_aliases = '' THEN excluded.name_primary
        WHEN instr(volleyball_teams.name_aliases, excluded.name_primary) THEN volleyball_teams.name_aliases
        ELSE volleyball_teams.name_aliases || '|' || excluded.name_primary
      END
  `);
	const hasRating = mainSqlite.prepare("SELECT 1 FROM volleyball_team_ratings WHERE team_id = ? LIMIT 1");
	const insertRating = mainSqlite.prepare(`
    INSERT OR IGNORE INTO volleyball_team_ratings (
      discipline, team_id, elo, match_count, set1_count, last_played_on, set1_recent, home_advantage, roster_strength
    ) VALUES (?, ?, ?, 0, 0, NULL, '[]', 0, 1)
  `);
	let added = 0;
	mainSqlite.transaction(() => {
		for (const match of matches) {
			if (!isVolleyballDiscipline(match.discipline)) continue;
			for (const team of [match.away, match.home]) {
				const teamId = `sportradar:${team.uid}`;
				insertTeam.run(teamId, team.name.trim());
				if (hasRating.get(teamId)) continue;
				insertRating.run(match.discipline, teamId, VOLLEYBALL_INITIAL_ELO);
				added += 1;
			}
		}
	})();
	return added;
};

const appendNameAliases = (existing: string, names: string[]) => {
	let aliases = existing;
	for (const name of names) {
		const trimmed = name.trim();
		if (!trimmed) continue;
		if (aliases === "") {
			aliases = trimmed;
			continue;
		}
		if (aliases.split("|").includes(trimmed)) continue;
		aliases = `${aliases}|${trimmed}`;
	}
	return aliases;
};

export const rememberVolleyballTeamNames = (mainSqlite: Sqlite, ledger: Sqlite, matches: StatshubMatch[]) => {
	if (!sqliteTableExists(mainSqlite, "volleyball_teams")) return;
	const findFixture = ledger.prepare("SELECT * FROM fixtures WHERE sportradar_id = ?");
	const readTeam = mainSqlite.prepare("SELECT name_primary, name_aliases FROM volleyball_teams WHERE team_id = ?");
	const updateTeam = mainSqlite.prepare("UPDATE volleyball_teams SET name_aliases = ? WHERE team_id = ?");
	mainSqlite.transaction(() => {
		for (const match of matches) {
			if (!isVolleyballDiscipline(match.discipline)) continue;
			const fixture = findFixture.get(match.sportradarId) as FixtureRow | undefined;
			if (!fixture) continue;
			const aligned = sameOrientation(match, fixture.away_name, fixture.home_name);
			const awayTeam = aligned ? match.away : match.home;
			const homeTeam = aligned ? match.home : match.away;
			const rows = [
				{ id: fixture.away_player_id, names: [fixture.away_name, fixture.away_name_zh, awayTeam.name] },
				{ id: fixture.home_player_id, names: [fixture.home_name, fixture.home_name_zh, homeTeam.name] }
			];
			for (const row of rows) {
				if (!row.id) continue;
				const team = readTeam.get(row.id) as { name_primary: string; name_aliases: string } | undefined;
				if (!team) continue;
				const next = appendNameAliases(team.name_aliases, row.names.filter((name) => name !== team.name_primary));
				if (next !== team.name_aliases) updateTeam.run(next, row.id);
			}
		}
	})();
};

export const unsettledFixtureDates = (ledger: Sqlite, today: string) => {
	const rows = ledger
		.prepare(
			`
    SELECT DISTINCT play_date FROM fixtures
    WHERE status IN ('pre', 'live') AND play_date <= ? AND play_date >= date(?, '-7 day')
    ORDER BY play_date
  `
		)
		.all(today, today) as Array<{ play_date: string }>;
	return rows.map((row) => row.play_date);
};

type BetRow = {
	quote_id: string | null;
	market_probability: number | null;
	source_market_id: string | null;
	odds_captured_at: string | null;
	id: string;
	ticket_id: string | null;
	fixture_id: number | null;
	sport: Sport | null;
	discipline: Discipline;
	away_name: string;
	home_name: string;
	starts_at: string | null;
	market: BetMarket;
	outcome_key: string;
	outcome_label: string;
	line: number | null;
	odds: number;
	stake: number;
	placed_at: string;
	model_version: string | null;
	probability: number | null;
	ev: number | null;
	action: BetAction | null;
	status: BetStatus;
	payout: number | null;
	closing_odds: number | null;
	closing_market: number | null;
	settled_at: string | null;
	note: string;
};

const resolvedSport = (sport: Sport | null | undefined, discipline: Discipline): Sport => sport ?? getSportForDiscipline(discipline) ?? "badminton";

const toBet = (row: BetRow): BetRecord => {
	return {
		quoteId: row.quote_id,
		marketProbability: row.market_probability,
		sourceMarketId: row.source_market_id,
		oddsCapturedAt: row.odds_captured_at,
		id: row.id,
		ticketId: row.ticket_id,
		fixtureId: row.fixture_id,
		sport: resolvedSport(row.sport, row.discipline),
		discipline: row.discipline,
		awayName: row.away_name,
		homeName: row.home_name,
		startsAt: row.starts_at,
		market: row.market,
		outcomeKey: row.outcome_key,
		outcomeLabel: row.outcome_label,
		line: row.line,
		odds: row.odds,
		stake: row.stake,
		placedAt: row.placed_at,
		modelVersion: row.model_version,
		probability: row.probability,
		ev: row.ev,
		action: row.action,
		status: row.status,
		payout: row.payout,
		closingOdds: row.closing_odds,
		closingMarket: row.closing_market,
		clv: closingLineValue(row.odds, row.closing_odds),
		settledAt: row.settled_at,
		note: row.note
	};
};

const writeBet = (ledger: Sqlite, input: TicketLegInput & { ticketId: string; note?: string }) => {
	const id = randomUUID();
	const prediction = input.quoteId ? readPrediction(ledger, input.quoteId) : null;
	const marketProbability = prediction ? quoteSelection(prediction.quote, input.market, input.outcomeKey)?.marketProbability ?? null : null;
	ledger
		.prepare(
			`
    INSERT INTO bets (
      id, ticket_id, fixture_id, sport, discipline, away_name, home_name, starts_at, market, outcome_key, outcome_label,
      line, odds, stake, placed_at, model_version, probability, ev, action, note, source_market_id, odds_captured_at, quote_id, market_probability
    ) VALUES (
      @id, @ticketId, @fixtureId, @sport, @discipline, @awayName, @homeName, @startsAt, @market, @outcomeKey, @outcomeLabel,
      @line, @odds, @stake, @placedAt, @modelVersion, @probability, @ev, @action, @note, @sourceMarketId, @oddsCapturedAt, @quoteId, @marketProbability
    )
  `
		)
		.run({
			...input,
			quoteId: input.quoteId ?? null,
			marketProbability,
			sourceMarketId: input.sourceMarketId ?? null,
			oddsCapturedAt: input.oddsCapturedAt ?? null,
			ev: input.probability === null ? null : input.probability * input.odds - 1,
			id,
			ticketId: input.ticketId,
			stake: 0,
			sport: resolvedSport(input.sport, input.discipline),
			note: input.note ?? "",
			placedAt: new Date().toISOString()
		});
	return id;
};

const marketSnapshots = (ledger: Sqlite, fixtureId: number, market: BetMarket, sourceMarketId: string | null): OddsSnapshot[] => {
	if (sourceMarketId) {
		const rows = ledger.prepare('SELECT captured_at, markets_json FROM market_snapshots WHERE fixture_id = ? ORDER BY captured_at').all(fixtureId) as Array<{ captured_at: string, markets_json: string }>;
		return rows.flatMap(row => (JSON.parse(row.markets_json) as FixtureMarket[])
			.filter(m => m.id === sourceMarketId && m.market === market && m.status === 'available')
			.flatMap(m => m.selections.flatMap(s => s.odds === null ? [] : [{ outcomeKey: s.key, line: m.line, odds: s.odds, capturedAt: row.captured_at }])));
	}
	return (
		ledger
			.prepare(
				`
    SELECT outcome_key, line, odds, captured_at FROM odds_snapshots
    WHERE fixture_id = ? AND market = ?
    ORDER BY captured_at, outcome_key
  `
			)
			.all(fixtureId, market) as Array<{ outcome_key: string; line: number | null; odds: number; captured_at: string }>
	).map((row) => ({ outcomeKey: row.outcome_key, line: row.line, odds: row.odds, capturedAt: row.captured_at }));
};

export const settleOpenBets = (ledger: Sqlite) => {
	const openBets = ledger
		.prepare(
			`
    SELECT b.*, f.status AS fixture_status, f.score AS fixture_score, f.starts_at AS fixture_starts_at,
           f.tournament AS fixture_tournament
    FROM bets b
    JOIN fixtures f ON f.sportradar_id = b.fixture_id
    WHERE b.status = 'open' AND f.status IN ('ended', 'void')
  `
		)
		.all() as Array<
		BetRow & {
			fixture_status: FixtureStatus;
			fixture_score: string;
			fixture_starts_at: string;
			fixture_tournament: string;
		}
	>;
	const update = ledger.prepare(`
    UPDATE bets SET status = ?, payout = ?, closing_odds = ?, closing_market = ?, settled_at = ?
    WHERE id = ?
  `);
	const settledAt = new Date().toISOString();
	ledger.transaction(() => {
		for (const row of openBets) {
			const sport = resolvedSport(row.sport, row.discipline);
			const status =
				row.fixture_status === "void"
					? "void"
					: settleBet(
							{ market: row.market, outcomeKey: row.outcome_key, line: row.line },
							parseGameScores(row.fixture_score),
							setsToWinFor(sport, row.fixture_tournament, row.discipline)
						);
			const closing = closingOdds(marketSnapshots(ledger, row.fixture_id!, row.market, row.source_market_id), { outcomeKey: row.outcome_key, line: row.line }, row.fixture_starts_at);
			update.run(status, betPayout(status, row.stake, row.odds), closing?.odds ?? null, closing?.market ?? null, settledAt, row.id);
		}
	})();
	return openBets.length;
};

const emptyOdds = (): FixtureOdds => emptyFixtureOdds();

type SnapshotRow = { market: BetMarket; outcome_key: string; line: number | null; odds: number };

const oddsFromSnapshots = (rows: SnapshotRow[]): FixtureOdds => {
	const odds = emptyOdds();
	const pick = (market: BetMarket, key: string) => rows.find((row) => row.market === market && row.outcome_key === key);
	const pair = (market: "match" | "set1") => {
		const away = pick(market, "away");
		const home = pick(market, "home");
		return away && home ? { away: away.odds, home: home.odds } : null;
	};
	odds.match = pair("match");
	odds.set1 = pair("set1");
	const over = pick("totals", "over");
	const under = pick("totals", "under");
	if (over && under && over.line !== null) odds.totals = { line: over.line, over: over.odds, under: under.odds };
	const handicapAway = pick("handicap", "away");
	const handicapHome = pick("handicap", "home");
	if (handicapAway && handicapHome && handicapAway.line !== null) {
		odds.handicap = { homeLine: -handicapAway.line, away: handicapAway.odds, home: handicapHome.odds };
	}
	const scoreRows = rows.filter((row) => row.market === "correctScore");
	if (scoreRows.length > 0) {
		odds.correctScore = Object.fromEntries(scoreRows.map((row) => [row.outcome_key, row.odds])) as Record<CorrectScore, number>;
	}
	const setHandicapAway = pick("setHandicap", "away");
	const setHandicapHome = pick("setHandicap", "home");
	if (setHandicapAway && setHandicapHome && setHandicapAway.line !== null) {
		odds.setHandicap = { homeLine: -setHandicapAway.line, away: setHandicapAway.odds, home: setHandicapHome.odds };
	}
	const set1Over = pick("set1Totals", "over");
	const set1Under = pick("set1Totals", "under");
	if (set1Over && set1Under && set1Over.line !== null) {
		odds.set1Totals = { line: set1Over.line, over: set1Over.odds, under: set1Under.odds };
	}
	const set1HandicapAway = pick("set1Handicap", "away");
	const set1HandicapHome = pick("set1Handicap", "home");
	if (set1HandicapAway && set1HandicapHome && set1HandicapAway.line !== null) {
		odds.set1Handicap = { homeLine: -set1HandicapAway.line, away: set1HandicapAway.odds, home: set1HandicapHome.odds };
	}
	const setCountRows = rows.filter((row) => row.market === "setCount");
	if (setCountRows.length > 0) {
		odds.setCount = Object.fromEntries(setCountRows.map((row) => [row.outcome_key, row.odds]));
	}
	return odds;
};

type RatingRow = {
	player_id: string;
	name_primary: string;
	elo: number;
	match_count: number;
	set1_count: number;
	last_played_on: string | null;
};

const COUNT_COLUMNS = ["set1_count", "game1_count"] as const;

const prepareRatingLookup = (sqlite: Sqlite) => {
	if (!sqliteTableExists(sqlite, "player_ratings") || !sqliteTableExists(sqlite, "players")) return null;
	const countColumn = existingColumn(sqlite, "player_ratings", COUNT_COLUMNS);
	const countSql = countColumn ? `r."${countColumn}"` : "0";
	try {
		return sqlite.prepare(`
      SELECT r.player_id, p.name_primary, r.elo, r.match_count, ${countSql} AS set1_count, r.last_played_on
      FROM player_ratings r
      JOIN players p ON p.player_id = r.player_id
      WHERE r.discipline = ? AND r.player_id = ?
    `);
	} catch {
		return null;
	}
};

type TeamRatingRow = RatingRow & { home_advantage: number; roster_strength: number };

const prepareTeamLookup = (sqlite: Sqlite) => {
	if (!sqliteTableExists(sqlite, "volleyball_team_ratings") || !sqliteTableExists(sqlite, "volleyball_teams")) return null;
	try {
		return sqlite.prepare(`
      SELECT r.team_id AS player_id, t.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on,
             r.home_advantage, r.roster_strength
      FROM volleyball_team_ratings r
      JOIN volleyball_teams t ON t.team_id = r.team_id
      WHERE r.discipline = ? AND r.team_id = ?
    `);
	} catch {
		return null;
	}
};

const prepareTennisLookup = (sqlite: Sqlite) => {
	if (!sqliteTableExists(sqlite, "tennis_player_ratings") || !sqliteTableExists(sqlite, "tennis_players")) return null;
	try {
		return sqlite.prepare(`
      SELECT r.player_id, p.name_primary, r.elo, r.match_count, r.set1_count, r.last_played_on
      FROM tennis_player_ratings r
      JOIN tennis_players p ON p.player_id = r.player_id
      WHERE r.discipline = ? AND r.player_id = ?
    `);
	} catch {
		return null;
	}
};

const createPlayerOptionReader = (mainSqlite: Sqlite | null) => {
	const ratingRow = mainSqlite ? prepareRatingLookup(mainSqlite) : null;
	const tennisRow = mainSqlite ? prepareTennisLookup(mainSqlite) : null;
	const teamRow = mainSqlite ? prepareTeamLookup(mainSqlite) : null;
	return (discipline: Discipline, playerId: string | null): Participant | null => {
		if (!playerId) return null;
		if (isVolleyballDiscipline(discipline) && teamRow) {
			const row = teamRow.get(discipline, playerId) as TeamRatingRow | undefined;
			if (!row) return null;
			return {
				id: row.player_id,
				name: row.name_primary,
				elo: row.elo,
				matchCount: row.match_count,
				set1Count: row.set1_count,
				lastPlayedOn: row.last_played_on,
				homeAdvantage: row.home_advantage,
				rosterStrength: row.roster_strength
			};
		}
		if (isTennisDiscipline(discipline) && tennisRow) {
			const other = discipline === "ATP" ? "WTA" : "ATP";
			const row = (tennisRow.get(discipline, playerId) ?? tennisRow.get(other, playerId)) as RatingRow | undefined;
			if (!row) return null;
			return {
				id: row.player_id,
				name: row.name_primary,
				elo: row.elo,
				matchCount: row.match_count,
				set1Count: row.set1_count,
				lastPlayedOn: row.last_played_on
			};
		}
		if (!ratingRow) return null;
		const row = ratingRow.get(discipline, playerId) as RatingRow | undefined;
		if (!row) return null;
		return {
			id: row.player_id,
			name: row.name_primary,
			elo: row.elo,
			matchCount: row.match_count,
			set1Count: row.set1_count,
			lastPlayedOn: row.last_played_on
		};
	};
};

export const listFixtures = (ledger: Sqlite, mainSqlite: Sqlite | null, date: string): FixtureSummary[] => {
	const fixtures = ledger.prepare("SELECT * FROM fixtures WHERE play_date = ? ORDER BY starts_at, sportradar_id").all(date) as FixtureRow[];
	const latestCapture = ledger.prepare("SELECT MAX(captured_at) AS captured_at FROM odds_snapshots WHERE fixture_id = ?");
	const snapshotRows = ledger.prepare("SELECT market, outcome_key, line, odds FROM odds_snapshots WHERE fixture_id = ? AND captured_at = ?");
	const playerOption = createPlayerOptionReader(mainSqlite);
	return fixtures.map((fixture) => {
		const current = latestMarketSnapshot(ledger, fixture.sportradar_id);
		const capturedAt = current?.capturedAt ?? (latestCapture.get(fixture.sportradar_id) as { captured_at: string | null }).captured_at;
		const odds = current ? defaultFixtureOdds(current.markets) : oddsFromSnapshots(capturedAt ? snapshotRows.all(fixture.sportradar_id, capturedAt) as SnapshotRow[] : []);
		const sport = resolvedSport(fixture.sport, fixture.discipline);
		return {
			sport,
			sportradarId: fixture.sportradar_id,
			discipline: fixture.discipline,
			tournament: fixture.tournament,
			startsAt: fixture.starts_at,
			status: fixture.status,
			score: fixture.score,
			awayName: fixture.away_name,
			homeName: fixture.home_name,
			awayNameZh: fixture.away_name_zh,
			homeNameZh: fixture.home_name_zh,
			away: playerOption(fixture.discipline, fixture.away_player_id),
			home: playerOption(fixture.discipline, fixture.home_player_id),
			markets: current?.markets,
			odds,
			oddsCapturedAt: capturedAt,
			isHome: sport === "volleyball",
			ignoredMarkets: JSON.parse(fixture.ignored_markets || "[]") as string[]
		};
	});
};

export const lastTslImport = (ledger: Sqlite) => {
	const row = ledger.prepare("SELECT value FROM ledger_state WHERE key = 'last_tsl_import'").get() as { value: string } | undefined;
	return row?.value ?? null;
};

const fixturesErrorMessage = (error: unknown) => {
	const reason = error instanceof Error ? error.message : String(error);
	if (reason.includes("no such column") || reason.includes("no such table")) {
		return "本機資料庫欄位與目前版本不一致。請重啟開發伺服器；若仍失敗，再執行 npm run update:data。";
	}
	return "今日對局讀取失敗，請稍後再試或重新匯入運彩賠率。";
};

export const emptyFixturesResponse = (message: string | null = null): FixturesResponse => ({
	date: taipeiDate(new Date()),
	lastImportAt: null,
	fixtures: [],
	message
});

export const readTodayFixtures = (ledger: Sqlite, mainSqlite: Sqlite | null, match: (fixture: FixtureSummary) => boolean): FixturesResponse => {
	const date = taipeiDate(new Date());
	try {
		return {
			date,
			lastImportAt: lastTslImport(ledger),
			fixtures: listFixtures(ledger, mainSqlite, date).filter(match),
			message: null
		};
	} catch (error) {
		return {
			date,
			lastImportAt: null,
			fixtures: [],
			message: fixturesErrorMessage(error)
		};
	}
};

type TicketRow = {
	archived_at: string | null;
	strategy: 'research' | 'conservative';
	id: string;
	kind: TicketKind;
	ledger_kind: LedgerKind;
	stake: number;
	combined_odds: number;
	combined_probability: number | null;
	ev: number | null;
	status: BetStatus;
	payout: number | null;
	placed_at: string;
	settled_at: string | null;
	note: string;
};

const toLeg = (bet: BetRecord): TicketLeg => ({
	quoteId: bet.quoteId,
	clv: bet.clv,
	marketProbability: bet.marketProbability,
	sourceMarketId: bet.sourceMarketId,
	oddsCapturedAt: bet.oddsCapturedAt,
	id: bet.id,
	fixtureId: bet.fixtureId,
	sport: bet.sport,
	discipline: bet.discipline,
	awayName: bet.awayName,
	homeName: bet.homeName,
	startsAt: bet.startsAt,
	market: bet.market,
	outcomeKey: bet.outcomeKey,
	outcomeLabel: bet.outcomeLabel,
	line: bet.line,
	odds: bet.odds,
	probability: bet.probability,
	ev: bet.ev,
	action: bet.action,
	modelVersion: bet.modelVersion,
	status: bet.status,
	payout: bet.payout
});

const toTicket = (row: TicketRow, legs: TicketLeg[]): TicketRecord => ({
	archivedAt: row.archived_at,
	strategy: row.strategy,
	id: row.id,
	kind: row.kind,
	ledgerKind: row.ledger_kind,
	stake: row.stake,
	combinedOdds: row.combined_odds,
	combinedProbability: row.combined_probability,
	ev: row.ev,
	status: row.status,
	payout: row.payout,
	placedAt: row.placed_at,
	settledAt: row.settled_at,
	note: row.note,
	legs
});

export const getBankroll = (ledger: Sqlite, kind: LedgerKind): BankrollRecord => {
	const row = ledger.prepare("SELECT kind, starting, balance FROM bankrolls WHERE kind = ?").get(kind) as
		| {
				kind: LedgerKind;
				starting: number;
				balance: number;
		  }
		| undefined;
	if (row) return { kind: row.kind, starting: row.starting, balance: row.balance };
	if (kind === "sim") return { kind, starting: DEFAULT_SIM_BANKROLL, balance: DEFAULT_SIM_BANKROLL };
	return { kind, starting: 0, balance: 0 };
};

const adjustBankroll = (ledger: Sqlite, kind: LedgerKind, delta: number) => {
	ledger.prepare("UPDATE bankrolls SET balance = balance + ? WHERE kind = ?").run(delta, kind);
};

const listBetsForTicket = (ledger: Sqlite, ticketId: string) =>
	(ledger.prepare("SELECT * FROM bets WHERE ticket_id = ? ORDER BY placed_at").all(ticketId) as BetRow[]).map(toBet);

const listTicketedBets = (ledger: Sqlite) => (ledger.prepare("SELECT * FROM bets WHERE ticket_id IS NOT NULL ORDER BY placed_at").all() as BetRow[]).map(toBet);

const legsByTicketId = (bets: BetRecord[]) => {
	const grouped = new Map<string, BetRecord[]>();
	for (const bet of bets) {
		if (!bet.ticketId) continue;
		const legs = grouped.get(bet.ticketId) ?? [];
		legs.push(bet);
		grouped.set(bet.ticketId, legs);
	}
	return grouped;
};

export const getTicket = (ledger: Sqlite, id: string) => {
	const row = ledger.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow | undefined;
	if (!row) return null;
	return toTicket(row, listBetsForTicket(ledger, id).map(toLeg));
};

export const listTickets = (ledger: Sqlite, sport: Sport | null = null, ledgerKind: LedgerKind | null = null, includeArchived = false, strategy: string | null = null) => {
	const rows = ledger.prepare("SELECT * FROM tickets ORDER BY placed_at DESC").all() as TicketRow[];
	const grouped = legsByTicketId(listTicketedBets(ledger));
	return rows.flatMap((row) => {
		if ((!includeArchived && row.archived_at) || (ledgerKind && row.ledger_kind !== ledgerKind) || (strategy && row.strategy !== strategy)) return [];
		const legs = (grouped.get(row.id) ?? []).map(toLeg);
		if (sport && !legs.some((leg) => leg.sport === sport)) return [];
		return [toTicket(row, legs)];
	});
};

export type PlaceTicketInput = {
	strategy?: 'research' | 'conservative';
	ledgerKind: LedgerKind;
	stake: number;
	legs: TicketLegInput[];
	note?: string;
};

export const insertTicket = (ledger: Sqlite, input: PlaceTicketInput) => {
	if (input.stake <= 0) throw new Error("金額要大於 0");
	if (input.strategy === 'conservative' && input.ledgerKind !== 'sim') throw new Error('保守模式僅供模擬研究');
	const quote = quoteParlay(input.legs);
	if (!isParlayQuote(quote)) throw new Error(quote.reason);
	const id = randomUUID();
	const placedAt = new Date().toISOString();
	ledger.transaction(() => {
		if (input.ledgerKind === 'sim') {
			if (!canAfford('sim', getBankroll(ledger, 'sim').balance, input.stake)) throw new Error('模擬本金不足');
			for (const leg of input.legs) validateSimulatedLeg(ledger, leg);
			if (input.strategy === 'conservative') validateConservativeTicket(ledger, input);
		} else {
			// A real-ledger entry can be a legacy manual record. If it claims to use a
			// saved quote, it must match that immutable quote just like a simulation.
			for (const leg of input.legs) if (leg.quoteId) verifyPrediction(ledger, leg);
		}
		ledger
			.prepare(
				`
      INSERT INTO tickets (
        id, kind, ledger_kind, stake, combined_odds, combined_probability, ev, status, placed_at, note, strategy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `
			)
			.run(id, input.legs.length === 1 ? 'single' : 'parlay', input.ledgerKind, input.stake, quote.combinedOdds, quote.combinedProbability, quote.ev, placedAt, input.note ?? "", input.strategy ?? 'research');
		recordTicketEvent(ledger, id, 'placed', { ...input, quote }, placedAt);
		for (const leg of input.legs) {
			writeBet(ledger, {
				...leg,
				ticketId: id,
				note: input.note ?? ""
			});
		}
		if (input.ledgerKind === "sim") adjustBankroll(ledger, "sim", -input.stake);
	})();
	return getTicket(ledger, id)!;
};

const recordTicketEvent = (ledger: Sqlite, id: string, event: string, payload: unknown, time = new Date().toISOString()) =>
	ledger.prepare('INSERT INTO ticket_events (ticket_id, created_at, event_type, payload_json) VALUES (?, ?, ?, ?)').run(id, time, event, JSON.stringify(payload));

// Archive only: outcomes, outstanding bets and bankroll history remain intact.
export const deleteTicket = (ledger: Sqlite, id: string) => {
	const ticket = getTicket(ledger, id);
	if (!ticket || ticket.archivedAt) return false;
	ledger.transaction(() => {
		const at = new Date().toISOString();
		ledger.prepare('UPDATE tickets SET archived_at = ? WHERE id = ?').run(at, id);
		recordTicketEvent(ledger, id, 'archived', { status: ticket.status }, at);
	})();
	return true;
};

const validateConservativeTicket = (ledger: Sqlite, input: PlaceTicketInput) => {
	const leg = input.legs[0];
	if (input.legs.length !== 1 || !leg || leg.sport !== 'badminton' || leg.market !== 'match') throw new Error('保守模擬僅支援羽球全場不讓分單注');
	const saved = verifyPrediction(ledger, leg);
	const eligibility = conservativeEligibility(saved.quote.matchWinner, leg.outcomeKey as 'away' | 'home');
	if (!eligibility.eligible) throw new Error(eligibility.reasons.join('；'));
	const bankroll = getBankroll(ledger, 'sim');
	const ticketCap = Math.min(bankroll.starting, bankroll.balance) * MAX_TICKET_FRACTION;
	if (input.stake > ticketCap + 1e-9) throw new Error('保守模擬每注不得超過起始與目前本金較低者的 1%');
	const today = taipeiDate(new Date());
	const tickets = listTickets(ledger, null, 'sim', true);
	const daily = tickets.filter(t => taipeiDate(new Date(t.placedAt)) === today).reduce((sum, t) => sum + t.stake, 0);
	if (daily + input.stake > bankroll.starting * MAX_DAILY_FRACTION + 1e-9) throw new Error('今日模擬投入已達起始本金 5% 上限');
	const sameFixture = tickets.filter(t => t.legs.some(l => l.fixtureId === leg.fixtureId)).reduce((sum, t) => sum + t.stake, 0);
	if (sameFixture + input.stake > bankroll.starting * MAX_TICKET_FRACTION + 1e-9) throw new Error('同一場次累計模擬投入已達起始本金 1% 上限');
};

export const validateSimulatedLeg = (ledger: Sqlite, leg: TicketLegInput, now = Date.now()) => {
	const fixture = ledger.prepare('SELECT * FROM fixtures WHERE sportradar_id = ?').get(leg.fixtureId) as FixtureRow | undefined;
	if (!fixture || fixture.status !== 'pre' || Date.parse(fixture.starts_at) <= now) throw new Error('場次已開賽、結束或不存在，請重新選擇');
	if (resolvedSport(fixture.sport, fixture.discipline) !== leg.sport || fixture.discipline !== leg.discipline) throw new Error('場次與球種不符，請重新選擇');
	const snapshot = latestMarketSnapshot(ledger, fixture.sportradar_id);
	if (!snapshot || !leg.sourceMarketId || snapshot.capturedAt !== leg.oddsCapturedAt) throw new Error('賠率版本已更新或尚未同步，請帶入最新賠率並重算');
	const age = now - Date.parse(snapshot.capturedAt);
	if (age < -300_000 || age > MAX_ODDS_AGE_MS) throw new Error('賠率已過期，請重新同步運彩');
	const market = snapshot.markets.find(m => m.id === leg.sourceMarketId && m.market === leg.market);
	if (!market || !marketIsOpen(market, now)) throw new Error('這個盤口已停賣或不支援，請重新選擇');
	const selection = market.selections.find(s => s.key === leg.outcomeKey);
	if (!selection || selection.odds !== leg.odds || market.line !== leg.line) throw new Error('盤口或賠率已變動，請重新計算後加入投注單');
	if (leg.quoteId) verifyPrediction(ledger, leg, now);
};

export const settleOpenTickets = (ledger: Sqlite) => {
	const openTickets = ledger.prepare(`SELECT * FROM tickets WHERE status = 'open'`).all() as TicketRow[];
	const grouped = legsByTicketId(listTicketedBets(ledger));
	const update = ledger.prepare(`
    UPDATE tickets SET status = ?, payout = ?, combined_odds = ?, settled_at = ? WHERE id = ?
  `);
	const settledAt = new Date().toISOString();
	let settled = 0;
	ledger.transaction(() => {
		for (const row of openTickets) {
			const legs = grouped.get(row.id) ?? [];
			if (legs.length === 0 || legs.some((leg) => leg.status === "open")) continue;
			const resolved = resolveParlayTicket(legs, row.stake);
			update.run(resolved.status, resolved.payout, resolved.combinedOdds, settledAt, row.id);
			recordTicketEvent(ledger, row.id, 'settled', resolved, settledAt);
			if (row.ledger_kind === "sim" && resolved.payout !== null) {
				adjustBankroll(ledger, "sim", resolved.payout);
			}
			settled += 1;
		}
	})();
	return settled;
};
