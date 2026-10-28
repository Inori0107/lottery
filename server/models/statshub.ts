import { z } from "zod";
import { getSportBySportradarId, isDoublesEvent, type Discipline, type Sport } from "../../shared/sports";
import type { CsvRow } from "./dataset";
import { firstGivenPlayerKey, foldPlayerName, initialsPlayerKey, isAbbreviatedGiven, type PlayerDirectory } from "./sun";

const TURBO_NULL = -5;
const MATCH_LIST_ROUTES = ["routes/_sh.sport.$sportId/index", "routes/_sh.sport.tennis/index"] as const;
const MATCH_PAGE_ROUTE = "routes/_sh.match.$matchId/_matchRoot";
const PLAYED_STATUS_IDS = new Set([100, 92]);

const ROUND_LABELS: Record<string, string> = {
	"1/64": "R128",
	"1/32": "R64",
	"1/16": "R32",
	"1/8": "R16",
	Quarterfinals: "QF",
	Quarterfinal: "QF",
	Semifinals: "SF",
	Semifinal: "SF",
	Final: "Final"
};

const sideSchema = z.object({
	home: z.number().nullish(),
	away: z.number().nullish()
});

const teamSchema = z.object({
	uid: z.number(),
	name: z.string()
});

const matchSchema = z.object({
	_id: z.number(),
	match_start: z.number(),
	match_status: z.string(),
	status: z.object({ _id: z.number() }).nullish(),
	periods: z.record(z.string(), sideSchema).nullish(),
	result: z.object({ winner: z.string().nullish() }).nullish(),
	teams: z.object({ home: teamSchema, away: teamSchema }),
	__roundName: z.object({ name: z.string().nullish() }).nullish()
});

const tournamentSchema = z.object({
	name: z.string(),
	matches: z.array(z.unknown())
});

const routeSchema = z.object({
	matchList: z.object({
		data: z
			.object({
				matchList: z.object({ tournaments: z.array(tournamentSchema) })
			})
			.nullish()
	}),
	validDates: z
		.object({
			data: z.object({ validCalendarDates: z.array(z.string()) }).nullish()
		})
		.nullish()
});

export type StatshubTeam = z.infer<typeof teamSchema>;

export type StatshubStatus = "pre" | "live" | "ended" | "abandoned";

export type StatshubGame = { home: number; away: number };

export type StatshubMatch = {
	sportradarId: number;
	playedOn: string;
	startsAt: string;
	discipline: Discipline;
	tournament: string;
	round: string;
	status: StatshubStatus;
	played: boolean;
	live: boolean;
	home: StatshubTeam;
	away: StatshubTeam;
	winner: "1" | "2" | "";
	score: string;
	games: StatshubGame[];
};

export type StatshubPage = {
	validDates: string[];
	matches: StatshubMatch[];
	hasLiveMatch: boolean;
};

export const decodeTurboStream = (html: string): unknown => {
	const chunks = [...html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1] ?? '""') as string);
	const firstLine = chunks.join("").split("\n")[0];
	if (!firstLine) throw new Error("頁面裡找不到內嵌資料，可能被擋或格式已變更");

	const values = JSON.parse(firstLine) as unknown[];
	const cache = new Map<number, unknown>();
	const hydrate = (index: number): unknown => {
		if (index === TURBO_NULL) return null;
		if (index < 0) return undefined;
		if (cache.has(index)) return cache.get(index);

		const value = values[index];
		if (Array.isArray(value)) {
			if (typeof value[0] === "string") {
				cache.set(index, undefined);
				return undefined;
			}
			const list: unknown[] = [];
			cache.set(index, list);
			for (const item of value) list.push(hydrate(Number(item)));
			return list;
		}
		if (value && typeof value === "object") {
			const record: Record<string, unknown> = {};
			cache.set(index, record);
			for (const [key, item] of Object.entries(value)) {
				record[String(hydrate(Number(key.slice(1))))] = hydrate(Number(item));
			}
			return record;
		}
		cache.set(index, value);
		return value;
	};
	return hydrate(0);
};

export const singlesDiscipline = (tournamentName: string) => {
	if (isDoublesEvent(tournamentName)) return null;
	const matched = tournamentName.match(/,\s*(MS|WS)\b/);
	if (matched?.[1] === "MS" || matched?.[1] === "WS") return matched[1];
	return null;
};

export const statshubVolleyballDiscipline = (tournamentName: string): "M" | "W" => {
	const lower = tournamentName.toLowerCase();
	if (lower.includes("women") || lower.includes("女") || /,\s*w\b/.test(lower)) return "W";
	return "M";
};

export const statshubTennisDiscipline = (tournamentName: string): "ATP" | "WTA" | null => {
	if (isDoublesEvent(tournamentName)) return null;
	const lower = tournamentName.toLowerCase();
	if (lower.includes("wta") || lower.includes("women") || lower.includes("女") || /,\s*w\b/.test(lower)) return "WTA";
	return "ATP";
};

type StatshubPeriods = Record<string, z.infer<typeof sideSchema>> | null | undefined;

const gameKeys = (periods: NonNullable<StatshubPeriods>) =>
	Object.keys(periods)
		.filter((key) => /^p\d+$/.test(key))
		.sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));

export const formatStatshubScore = (periods: StatshubPeriods) => {
	if (!periods) return "";
	return gameKeys(periods)
		.map((key) => `${periods[key]?.home ?? ""}-${periods[key]?.away ?? ""}`)
		.join(" ");
};

const statshubGames = (periods: StatshubPeriods): StatshubGame[] => {
	if (!periods) return [];
	return gameKeys(periods).flatMap((key) => {
		const home = periods[key]?.home;
		const away = periods[key]?.away;
		return typeof home === "number" && typeof away === "number" ? [{ home, away }] : [];
	});
};

const matchStatus = (matchStatus: string, statusId: number): StatshubStatus => {
	if (matchStatus === "live") return "live";
	if (matchStatus !== "post") return "pre";
	return PLAYED_STATUS_IDS.has(statusId) ? "ended" : "abandoned";
};

const formatRound = (roundName: string, qualifying: boolean) => {
	const label = ROUND_LABELS[roundName] ?? roundName;
	if (!qualifying) return label;
	return label ? `Q ${label}` : "Q";
};

const toStatshubMatch = (raw: unknown, tournamentName: string, sport: Sport = "badminton"): StatshubMatch | null => {
	const discipline =
		sport === "volleyball"
			? statshubVolleyballDiscipline(tournamentName)
			: sport === "tennis"
				? statshubTennisDiscipline(tournamentName)
				: singlesDiscipline(tournamentName);
	if (!discipline) return null;
	const parsed = matchSchema.safeParse(raw);
	if (!parsed.success) return null;

	const match = parsed.data;
	const playedOn = new Date(match.match_start * 1000).toISOString().slice(0, 10);
	const baseName = (tournamentName.split(",")[0] ?? "").trim();
	const qualifying = /qual/i.test(tournamentName);
	const winner = match.result?.winner;
	const status = matchStatus(match.match_status, match.status?._id ?? -1);
	return {
		sportradarId: match._id,
		playedOn,
		startsAt: new Date(match.match_start * 1000).toISOString(),
		discipline,
		tournament: `${baseName} ${playedOn.slice(0, 4)}`,
		round: formatRound(match.__roundName?.name?.trim() ?? "", qualifying),
		status,
		played: status === "ended",
		live: status === "live",
		home: match.teams.home,
		away: match.teams.away,
		winner: winner === "home" ? "1" : winner === "away" ? "2" : "",
		score: formatStatshubScore(match.periods),
		games: statshubGames(match.periods)
	};
};

const matchPageTeamSchema = z.object({
	uid: z.number(),
	name: z.string()
});

const matchPageInfoSchema = z.object({
	match: z
		.object({
			_id: z.number(),
			_sid: z.number().nullish(),
			match_start: z.number().nullish(),
			_dt: z.object({ uts: z.number() }).nullish(),
			matchstatus: z.union([z.string(), z.boolean()]).nullish(),
			status: z.object({ _id: z.number(), name: z.string().nullish() }).nullish(),
			periods: z.record(z.string(), sideSchema).nullish(),
			result: z.object({ winner: z.string().nullish() }).nullish(),
			teams: z.object({ home: matchPageTeamSchema, away: matchPageTeamSchema }),
			roundname: z
				.object({
					name: z.union([z.string(), z.number()]).nullish().transform((value) => (value == null ? undefined : String(value)))
				})
				.nullish(),
			walkover: z.boolean().nullish(),
			cancelled: z.boolean().nullish()
		})
		.passthrough(),
	tournament: z
		.object({
			name: z.string().nullish(),
			_gender: z.string().nullish(),
			tennisinfo: z
				.object({
					gender: z.string().nullish(),
					type: z.string().nullish()
				})
				.nullish()
		})
		.passthrough()
		.nullish(),
	uniquetournament: z.object({ name: z.string().nullish() }).passthrough().nullish(),
	realcategory: z.object({ name: z.string().nullish() }).passthrough().nullish(),
	sport: z.object({ _id: z.number().nullish() }).passthrough().nullish()
});

const matchListStatus = (match: z.infer<typeof matchPageInfoSchema>["match"]) => {
	const statusId = match.status?._id ?? -1;
	const statusName = (match.status?.name ?? "").toLowerCase();
	if (match.walkover || match.cancelled || statusId === 93) return { match_status: "post", statusId: 93 };
	if (match.matchstatus === "live" || statusName.includes("set") || statusId === 1) return { match_status: "live", statusId };
	if (match.matchstatus === "result" || statusId === 100 || statusId === 92 || statusName === "ended") {
		return { match_status: "post", statusId: statusId === 92 ? 92 : 100 };
	}
	return { match_status: "pre", statusId };
};

export const parseStatshubMatchPage = (html: string): StatshubMatch | null => {
	const root = decodeTurboStream(html) as { loaderData?: Record<string, unknown> };
	const route = root.loaderData?.[MATCH_PAGE_ROUTE] as { matchInfo?: { data?: unknown }; sportId?: number } | undefined;
	const parsed = matchPageInfoSchema.safeParse(route?.matchInfo?.data);
	if (!parsed.success) return null;
	const info = parsed.data;
	const sportId = Number(info.sport?._id ?? info.match._sid ?? route?.sportId);
	const sport = getSportBySportradarId(sportId);
	if (!sport) return null;
	const tournamentName = [
		info.uniquetournament?.name,
		info.realcategory?.name,
		info.tournament?.name,
		info.tournament?._gender,
		info.tournament?.tennisinfo?.gender,
		info.tournament?.tennisinfo?.type
	]
		.filter((part): part is string => Boolean(part))
		.join(" | ");
	const start = info.match.match_start ?? info.match._dt?.uts;
	if (!start) return null;
	const listed = matchListStatus(info.match);
	return toStatshubMatch(
		{
			_id: info.match._id,
			match_start: start,
			match_status: listed.match_status,
			status: { _id: listed.statusId, name: info.match.status?.name },
			periods: info.match.periods,
			result: info.match.result,
			teams: info.match.teams,
			__roundName: { name: info.match.roundname?.name }
		},
		tournamentName,
		sport
	);
};

export const parseStatshubPage = (html: string, sport: Sport = "badminton"): StatshubPage => {
	const root = decodeTurboStream(html) as { loaderData?: Record<string, unknown> };
	const preferred = sport === "tennis" ? MATCH_LIST_ROUTES[1] : MATCH_LIST_ROUTES[0];
	const route = [preferred, ...MATCH_LIST_ROUTES]
		.map((key) => routeSchema.safeParse(root.loaderData?.[key]))
		.find((parsed) => parsed.success);
	if (!route?.success) throw new Error("賽程頁資料結構不符，可能格式已變更");

	const validDates = route.data.validDates?.data?.validCalendarDates ?? [];
	const tournaments = route.data.matchList.data?.matchList.tournaments ?? [];
	const matches = tournaments.flatMap((tournament) =>
		tournament.matches.map((raw) => toStatshubMatch(raw, tournament.name, sport)).filter((match): match is StatshubMatch => match !== null)
	);
	return { validDates, matches, hasLiveMatch: matches.some((match) => match.live) };
};

export const splitStatshubName = (raw: string) => {
	const [surname = "", ...rest] = raw.split(",").map((part) => part.trim().replace(/\s+/g, " "));
	return { surname, given: rest.join(" ").trim() };
};

export const statshubDisplayName = (raw: string) => {
	const { surname, given } = splitStatshubName(raw);
	if (!given) return surname;
	return `${given} ${surname.toUpperCase()}`;
};

const linkAbbreviatedEntry = (surname: string, given: string, directory: PlayerDirectory) => {
	const key = initialsPlayerKey(surname, given);
	const id = directory.byAbbreviatedInitials.get(key);
	if (!id || directory.byInitials.get(key) !== id) return undefined;
	return id;
};

export const linkStatshubName = (raw: string, directory: PlayerDirectory) => {
	const trimmed = raw.trim().replace(/\s+/g, " ");
	if (!trimmed) return undefined;
	const exactStored = directory.byExact.get(trimmed) ?? directory.byFolded.get(foldPlayerName(trimmed));
	if (exactStored) return exactStored;
	const { surname, given } = splitStatshubName(trimmed);
	if (!surname) return undefined;
	const exact = directory.byExact.get(statshubDisplayName(trimmed));
	if (exact) return exact;
	if (!given) return directory.byFolded.get(foldPlayerName(surname));
	if (isAbbreviatedGiven(given)) return directory.byInitials.get(initialsPlayerKey(surname, given));
	const linked =
		directory.byCanonical.get(`${foldPlayerName(surname)}|${foldPlayerName(given)}`) ??
		directory.byFolded.get(foldPlayerName(`${surname}${given}`)) ??
		directory.byFolded.get(foldPlayerName(`${given}${surname}`)) ??
		linkAbbreviatedEntry(surname, given, directory);
	if (linked) return linked;
	if (given.includes(" ")) return undefined;
	return directory.byFirstGiven.get(firstGivenPlayerKey(surname, given));
};

const linkStatshubNames = (names: string[], directory: PlayerDirectory) => {
	const linkedIds = new Set(names.map((name) => linkStatshubName(name, directory)).filter((id): id is string => Boolean(id)));
	return linkedIds.size === 1 ? [...linkedIds][0] : undefined;
};

const statshubPlayerId = (uid: number) => `sportradar:${uid}`;

export const resolveStatshubPlayer = (names: string[], uid: number | null, directory: PlayerDirectory, knownIds: Set<string>) => {
	const linked = linkStatshubNames(names, directory);
	if (linked) return linked;
	if (uid === null) return undefined;
	const fallback = statshubPlayerId(uid);
	return knownIds.has(fallback) ? fallback : undefined;
};

export type StatshubNewPlayer = {
	discipline: "MS" | "WS";
	playerId: string;
	name: string;
};

export const statshubMatchesToCsv = (matches: StatshubMatch[], directories: Record<"MS" | "WS", PlayerDirectory>) => {
	const uniqueMatches = [...new Map(matches.map((match) => [match.sportradarId, match])).values()];
	const played = uniqueMatches.filter(
		(match): match is StatshubMatch & { discipline: "MS" | "WS" } => match.played && (match.discipline === "MS" || match.discipline === "WS")
	);

	const namesByPlayer = new Map<string, { discipline: "MS" | "WS"; uid: number; names: Set<string> }>();
	for (const match of played) {
		for (const team of [match.home, match.away]) {
			const key = `${match.discipline}|${team.uid}`;
			const entry = namesByPlayer.get(key) ?? { discipline: match.discipline, uid: team.uid, names: new Set<string>() };
			entry.names.add(team.name.trim());
			namesByPlayer.set(key, entry);
		}
	}

	const resolved = new Map<string, { id: string; name: string }>();
	const newPlayers: StatshubNewPlayer[] = [];
	let linkedPlayers = 0;
	for (const [key, entry] of namesByPlayer) {
		const names = [...entry.names];
		const fullName = names.find((name) => !isAbbreviatedGiven(splitStatshubName(name).given)) ?? names[0] ?? "";
		const linkedId = linkStatshubNames(names, directories[entry.discipline]);
		const displayName = statshubDisplayName(fullName);
		if (linkedId) {
			linkedPlayers += 1;
			resolved.set(key, { id: linkedId, name: displayName });
			continue;
		}
		const playerId = statshubPlayerId(entry.uid);
		resolved.set(key, { id: playerId, name: displayName });
		newPlayers.push({ discipline: entry.discipline, playerId, name: displayName });
	}

	const formatTeam = (match: StatshubMatch, team: StatshubTeam) => {
		const player = resolved.get(`${match.discipline}|${team.uid}`);
		if (!player) return "";
		return `${player.name} [${player.id}]`;
	};

	const rows: CsvRow[] = played.map((match) => ({
		date: match.playedOn,
		discipline: match.discipline,
		tournament: match.tournament,
		tier: "",
		round: match.round,
		host_location: "",
		team1: formatTeam(match, match.home),
		team2: formatTeam(match, match.away),
		winner: match.winner,
		score: match.score
	}));

	return {
		rows,
		skippedScoring: uniqueMatches.length - played.length,
		linkedPlayers,
		newPlayers: newPlayers.sort((left, right) => left.discipline.localeCompare(right.discipline) || left.name.localeCompare(right.name))
	};
};
