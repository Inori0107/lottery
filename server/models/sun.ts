import { playerIdentity, type CsvRow } from "./dataset";

export const TIER_LABELS: Record<string, string> = {
	OG: "奧運",
	WC: "世錦賽",
	WTF: "年終總決賽",
	S1000: "超級 1000",
	S750: "超級 750",
	S500: "超級 500",
	S300: "超級 300",
	S100: "超級 100",
	SSF: "超級系列賽總決賽",
	SSP: "超級系列賽 Premier",
	SS: "超級系列賽",
	GPG: "黃金大獎賽",
	GP: "大獎賽",
	IC: "國際挑戰賽",
	IS: "國際系列賽",
	FS: "未來系列賽"
};

const SKIPPED_FORMATS = new Set(["walkover", "pt11", "pt15", "unknown"]);

export const excelSerialToIso = (value: string) => {
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
	const serial = Number(trimmed);
	if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return "";
	const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
	return new Date(utc).toISOString().slice(0, 10);
};

export const normalizeMatchScore = (score: string) => score.replaceAll("/", " ").replace(/\s+/g, " ").trim();

const LETTER_FOLDS: Record<string, string> = { Æ: "AE", Ø: "OE", Œ: "OE", Ð: "D", Þ: "TH", Ł: "L" };

export const foldPlayerName = (name: string) =>
	name
		.toUpperCase()
		.replace(/[ÆØŒÐÞŁ]/g, (letter) => LETTER_FOLDS[letter] ?? letter)
		.normalize("NFD")
		.replace(/[^A-Z0-9]/g, "");

const cleanToken = foldPlayerName;

const isSurnameToken = (token: string) => {
	const folded = cleanToken(token);
	return token === token.toUpperCase() && folded.length > 1 && /[A-Z]/.test(folded);
};

export const isAbbreviatedGiven = (given: string) => given.includes(".") || given.split(/[\s-]+/).some((token) => cleanToken(token).length === 1);

export const splitPlayerName = (name: string) => {
	const tokens = name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
	const surnameTokens = tokens.filter(isSurnameToken);
	const givenTokens = tokens.filter((token) => !surnameTokens.includes(token));
	if (surnameTokens.length === 0 || givenTokens.length === 0) return null;
	return { surname: surnameTokens.join(" "), given: givenTokens.join(" ") };
};

export const canonicalPlayerKey = (name: string) => {
	const parts = splitPlayerName(name);
	if (!parts) return foldPlayerName(name);
	return `${foldPlayerName(parts.surname)}|${foldPlayerName(parts.given)}`;
};

export const givenInitials = (given: string) =>
	given
		.split(/[\s.\-]+/)
		.map(cleanToken)
		.filter(Boolean)
		.map((token) => token[0])
		.join("");

export const initialsPlayerKey = (surname: string, given: string) => `${foldPlayerName(surname)}|${givenInitials(given)}`;

export const firstGivenPlayerKey = (surname: string, given: string) => `${foldPlayerName(surname)}|${cleanToken(given.split(/\s+/)[0] ?? "")}`;

export type PlayerDirectory = {
	byExact: Map<string, string>;
	byCanonical: Map<string, string>;
	byFolded: Map<string, string>;
	byInitials: Map<string, string>;
	byAbbreviatedInitials: Map<string, string>;
	byFirstGiven: Map<string, string>;
};

const uniqueIds = (groups: Map<string, Set<string>>) => {
	const directory = new Map<string, string>();
	for (const [key, ids] of groups) {
		if (ids.size !== 1) continue;
		const id = [...ids][0];
		if (id) directory.set(key, id);
	}
	return directory;
};

export const buildPlayerDirectory = (players: Array<{ id: string; name: string }>): PlayerDirectory => {
	const exactGroups = new Map<string, Set<string>>();
	const canonicalGroups = new Map<string, Set<string>>();
	const foldedGroups = new Map<string, Set<string>>();
	const initialsGroups = new Map<string, Set<string>>();
	const abbreviatedInitialsGroups = new Map<string, Set<string>>();
	const firstGivenGroups = new Map<string, Set<string>>();
	const addToGroup = (groups: Map<string, Set<string>>, key: string, id: string) => {
		const ids = groups.get(key) ?? new Set<string>();
		ids.add(id);
		groups.set(key, ids);
	};
	for (const player of players) {
		const name = player.name.trim().replace(/\s+/g, " ");
		if (!name || !player.id) continue;
		addToGroup(exactGroups, name, player.id);
		addToGroup(canonicalGroups, canonicalPlayerKey(name), player.id);
		addToGroup(foldedGroups, foldPlayerName(name), player.id);
		const parts = splitPlayerName(name);
		if (!parts) continue;
		const initialsKey = initialsPlayerKey(parts.surname, parts.given);
		addToGroup(initialsGroups, initialsKey, player.id);
		if (isAbbreviatedGiven(parts.given)) addToGroup(abbreviatedInitialsGroups, initialsKey, player.id);
		addToGroup(firstGivenGroups, firstGivenPlayerKey(parts.surname, parts.given), player.id);
	}
	return {
		byExact: uniqueIds(exactGroups),
		byCanonical: uniqueIds(canonicalGroups),
		byFolded: uniqueIds(foldedGroups),
		byInitials: uniqueIds(initialsGroups),
		byAbbreviatedInitials: uniqueIds(abbreviatedInitialsGroups),
		byFirstGiven: uniqueIds(firstGivenGroups)
	};
};

export const formatLinkedName = (raw: string, directory: PlayerDirectory) => {
	const identity = playerIdentity(raw);
	const linkedId =
		directory.byExact.get(identity.name) ??
		directory.byCanonical.get(canonicalPlayerKey(identity.name)) ??
		directory.byFolded.get(foldPlayerName(identity.name));
	if (!linkedId || linkedId === identity.id) return raw.trim();
	return `${identity.name} [${linkedId}]`;
};

const headerIndex = (header: string[], name: string) => {
	const index = header.indexOf(name);
	if (index < 0) throw new Error(`缺少欄位 ${name}`);
	return index;
};

const rowValue = (row: string[], index: number) => (row[index] ?? "").trim();

export const sunTablesToCsv = (tournamentRows: string[][], playerRows: string[][], matchRows: string[][]) => {
	const tournamentHeader = tournamentRows[0] ?? [];
	const playerHeader = playerRows[0] ?? [];
	const matchHeader = matchRows[0] ?? [];
	const tournamentId = headerIndex(tournamentHeader, "tournament_id");
	const tournamentName = headerIndex(tournamentHeader, "name");
	const tournamentCountry = headerIndex(tournamentHeader, "country");
	const tournamentLevel = headerIndex(tournamentHeader, "ranking_level");
	const playerId = headerIndex(playerHeader, "player_id");
	const playerName = headerIndex(playerHeader, "name");
	const matchDate = headerIndex(matchHeader, "match_date");
	const matchTournament = headerIndex(matchHeader, "tournament_id");
	const matchType = headerIndex(matchHeader, "type");
	const matchRound = headerIndex(matchHeader, "round");
	const winnerId = headerIndex(matchHeader, "winner_id");
	const loserId = headerIndex(matchHeader, "loser_id");
	const score = headerIndex(matchHeader, "score");
	const scoreFormat = headerIndex(matchHeader, "score_format");

	const tournaments = new Map<string, { name: string; country: string; tier: string }>();
	for (const row of tournamentRows.slice(1)) {
		const id = rowValue(row, tournamentId);
		if (!id) continue;
		const level = rowValue(row, tournamentLevel);
		tournaments.set(id, {
			name: rowValue(row, tournamentName),
			country: rowValue(row, tournamentCountry),
			tier: TIER_LABELS[level] ?? level
		});
	}

	const players: Array<{ id: string; name: string }> = [];
	const playerNames = new Map<string, string>();
	for (const row of playerRows.slice(1)) {
		const id = rowValue(row, playerId);
		const name = rowValue(row, playerName).replace(/\s+/g, " ");
		if (!id || !name) continue;
		players.push({ id, name });
		playerNames.set(id, name);
	}

	const rows: CsvRow[] = [];
	let skippedScoring = 0;
	for (const row of matchRows.slice(1)) {
		const format = rowValue(row, scoreFormat);
		if (SKIPPED_FORMATS.has(format)) {
			skippedScoring += 1;
			continue;
		}
		const winner = rowValue(row, winnerId);
		const loser = rowValue(row, loserId);
		const winnerName = playerNames.get(winner);
		const loserName = playerNames.get(loser);
		const event = tournaments.get(rowValue(row, matchTournament));
		rows.push({
			date: excelSerialToIso(rowValue(row, matchDate)),
			discipline: rowValue(row, matchType),
			tournament: event?.name ?? rowValue(row, matchTournament),
			tier: event?.tier ?? "",
			round: rowValue(row, matchRound),
			host_location: event?.country ?? "",
			team1: winnerName ? `${winnerName} [${winner}]` : "",
			team2: loserName ? `${loserName} [${loser}]` : "",
			winner: "1",
			score: normalizeMatchScore(rowValue(row, score))
		});
	}

	return {
		rows,
		skippedScoring,
		directory: buildPlayerDirectory(players)
	};
};
