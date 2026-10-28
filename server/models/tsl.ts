import { z } from "zod";
import { isHalfLine } from "../../shared/decision";
import { BADMINTON_MARKETS, defaultFixtureOdds } from "../../shared/fixtureMarkets";
import type { FixtureMarket } from "../../shared/types";
import {
	BADMINTON_CORRECT_SCORES,
	TENNIS_BO3_CORRECT_SCORES,
	TENNIS_BO5_CORRECT_SCORES,
	VOLLEYBALL_CORRECT_SCORES,
	emptyFixtureOdds,
	type BetMarket,
	type CorrectScore,
	type Discipline,
	type FixtureOdds,
	type Sport
} from "../../shared/types";
import { getCorrectScoresForSport, getSportByTslCode, isDoublesEvent } from "../../shared/sports";

export const TSL_ORIGIN = "https://www-talo-ssb-pr.sportslottery.com.tw";

export const TSL_SPORT_CODES = {
	badminton: "BAD",
	volleyball: "VOL",
	tennis: "TENN"
} as const;

const asText = z.union([z.string(), z.number()]).transform((value) => String(value));

const selectionSchema = z.object({
	idfoselection: asText.nullish(),
	idfobolifestate: asText.nullish(),
	istradable: z.boolean().nullish(),
	name: z.string(),
	hadvalue: z.string().nullish(),
	currentpriceup: asText.nullish(),
	currentpricedown: asText.nullish(),
	currenthandicap: asText.nullish()
});

const marketSchema = z.object({
	idfomarket: asText.nullish(),
	idfomarkettype: asText.nullish(),
	idfobolifestate: asText.nullish(),
	csvavailablebettypes: z.string().nullish(),
	tsbetend: z.string().nullish(),
	name: z.string(),
	istradable: z.boolean().nullish(),
	ismainline: z.boolean().nullish(),
	selections: z.array(selectionSchema).default([])
});

const eventSchema = z.object({
	istradable: z.boolean().nullish(),
	idfoevent: asText,
	idfosporttype: asText,
	participantname_away: asText,
	participantname_home: asText,
	tsstart: asText,
	tournamentname: z.union([z.string(), z.number()]).optional().transform((value) => (value == null ? "" : String(value))),
	externalreference: asText.nullish(),
	markets: z.array(z.unknown()).default([])
});

const englishSchema = z.object({
	idfoevent: z.string(),
	participantname_away: z.string(),
	participantname_home: z.string()
});

export const tslPayloadSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
	date: z.string(),
	english: z.array(englishSchema),
	events: z.array(z.unknown()),
	meta: z
		.object({
			groups: z.number().optional(),
			listed: z.number().optional()
		})
		.optional()
});

export type TslPayload = z.infer<typeof tslPayloadSchema>;

type TslEvent = z.infer<typeof eventSchema>;
type TslMarket = z.infer<typeof marketSchema>;
type TslSelection = z.infer<typeof selectionSchema>;

export type TslOddsRow = {
	market: BetMarket;
	outcomeKey: string;
	line: number | null;
	odds: number;
};

export type TslFixture = {
	markets?: FixtureMarket[];
	sport: Sport;
	tslEventId: string;
	sportradarId: number;
	discipline: Discipline;
	tournament: string;
	startsAt: string;
	awayName: string;
	homeName: string;
	awayNameZh: string;
	homeNameZh: string;
	odds: FixtureOdds;
	rows: TslOddsRow[];
	ignoredMarkets: string[];
};

export type TslParseResult = {
	fixtures: TslFixture[];
	skipped: Array<{ name: string; reason: string }>;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

export const tslBadmintonDiscipline = (tournament: string): Discipline | null => {
	if (isDoublesEvent(tournament)) return null;
	if (tournament.includes("男子單打")) return "MS";
	if (tournament.includes("女子單打")) return "WS";
	return null;
};

export const tslVolleyballDiscipline = (tournament: string): Discipline | null => {
	const lower = tournament.toLowerCase();
	if (lower.includes("沙灘") || lower.includes("beach") || isDoublesEvent(tournament)) return null;
	if (lower.includes("女") || lower.includes("women") || lower.includes("women's")) return "W";
	if (lower.includes("男") || lower.includes("men") || lower.includes("men's")) return "M";
	return "M";
};

export const tslTennisDiscipline = (tournament: string): Discipline | null => {
	if (isDoublesEvent(tournament)) return null;
	const lower = tournament.toLowerCase();
	if (lower.includes("女") || lower.includes("wta") || lower.includes("women") || lower.includes("women's")) return "WTA";
	return "ATP";
};

export const tslDiscipline = (sport: Sport, tournament: string): Discipline | null => {
	if (sport === "badminton") return tslBadmintonDiscipline(tournament);
	if (sport === "volleyball") return tslVolleyballDiscipline(tournament);
	if (sport === "tennis") return tslTennisDiscipline(tournament);
	return null;
};

export const sportradarMatchId = (reference: string | null | undefined) => {
	const matched = reference?.match(/^sr:match:(\d+)$/);
	return matched ? Number(matched[1]) : null;
};

export const fractionalToDecimal = (up: string | null | undefined, down: string | null | undefined) => {
	const numerator = Number(up);
	const denominator = Number(down);
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null;
	return Math.round((1 + numerator / denominator) * 100) / 100;
};

const selectionOdds = (selection: TslSelection | undefined) => (selection ? fractionalToDecimal(selection.currentpriceup, selection.currentpricedown) : null);

const bySide = (market: TslMarket, side: "A" | "H") => market.selections.find((selection) => selection.hadvalue === side);

const trailingLine = (name: string) => {
	const matched = clean(name).match(/([+-]?\d+(?:\.\d+)?)$/);
	return matched ? Number(matched[1]) : null;
};

export const classifyTslMarket = (rawName: string): { kind: BetMarket | "ignored"; name: string } => {
	const name = clean(rawName);
	if (name === "不讓分") return { kind: "match", name };
	if (name === "[第1盤]不讓分" || name === "[第1局]不讓分") return { kind: "set1", name };
	if (name.startsWith("[總分]大小") || name.startsWith("[總局數]大小")) return { kind: "totals", name };
	if (name.startsWith("[總分]讓分") || name.startsWith("[總局數]讓分")) return { kind: "handicap", name };
	if (name === "正確比數") return { kind: "correctScore", name };
	if (
		name.startsWith("局數讓分") ||
		name.startsWith("[局數]讓分") ||
		name.startsWith("盤數讓分") ||
		name.startsWith("[盤數]讓分") ||
		name === "讓盤" ||
		name.startsWith("讓盤 ")
	)
		return { kind: "setHandicap", name };
	if (name === "讓局" || name.startsWith("讓局 ")) return { kind: "handicap", name };
	if (name.startsWith("[第1盤]大小") || name.startsWith("[第1局]大小")) return { kind: "set1Totals", name };
	if (name.startsWith("[第1盤]讓分") || name.startsWith("[第1局]讓分")) return { kind: "set1Handicap", name };
	if (name === "正確盤數") return { kind: "correctScore", name };
	if (name === "正確總局數" || name.startsWith("正確總局數") || name === "正確總盤數" || name.startsWith("正確總盤數")) return { kind: "setCount", name };
	return { kind: "ignored", name };
};

const twoWay = (market: TslMarket | undefined) => {
	if (!market) return null;
	const away = selectionOdds(bySide(market, "A"));
	const home = selectionOdds(bySide(market, "H"));
	return away && home ? { away, home } : null;
};

const totalsOdds = (market: TslMarket | undefined) => {
	if (!market) return null;
	const over = market.selections.find((selection) => clean(selection.name).startsWith("大"));
	const under = market.selections.find((selection) => clean(selection.name).startsWith("小"));
	const line = Number(over?.currenthandicap ?? trailingLine(market.name));
	const underLine = Number(under?.currenthandicap ?? trailingLine(market.name));
	const overOdds = selectionOdds(over);
	const underOdds = selectionOdds(under);
	if (!isHalfLine(line) || line <= 0 || line !== underLine || !overOdds || !underOdds) return null;
	return { line, over: overOdds, under: underOdds };
};

const handicapOdds = (market: TslMarket | undefined) => {
	if (!market) return null;
	const awaySelection = bySide(market, "A");
	const homeSelection = bySide(market, "H");
	const rawLine = homeSelection?.currenthandicap;
	const homeLine = trailingLine(homeSelection?.name ?? "") ?? trailingLine(market.name)
		?? (rawLine != null && rawLine.trim() !== "" && Number.isFinite(Number(rawLine)) ? Number(rawLine) : null);
	const away = selectionOdds(awaySelection);
	const home = selectionOdds(homeSelection);
	if (homeLine === null || !isHalfLine(homeLine) || !away || !home) return null;
	return { homeLine, away, home };
};

const correctScoreOdds = (market: TslMarket | undefined, scores: readonly CorrectScore[]) => {
	if (!market) return null;
	const entries = scores.map((score) => {
		const selection = market.selections.find((item) => clean(item.name) === score);
		return [score, selectionOdds(selection)] as const;
	});
	const validEntries = entries.filter(([, odds]) => odds !== null);
	if (validEntries.length === 0) return null;
	return Object.fromEntries(validEntries) as Partial<Record<CorrectScore, number>>;
};

const setCountOdds = (market: TslMarket | undefined) => {
	if (!market) return null;
	const entries = market.selections.flatMap((selection) => {
		const key = clean(selection.name).replace(/[局盤]$/, "");
		const odds = selectionOdds(selection);
		return /^\d+$/.test(key) && odds ? [[key, odds] as const] : [];
	});
	return entries.length >= 2 ? Object.fromEntries(entries) : null;
};

const parseMarketOdds = (kind: BetMarket | 'ignored', market: TslMarket, sport: Sport, tournament: string): FixtureOdds => {
	const odds = emptyFixtureOdds();
	switch (kind) {
		case 'match': case 'set1': odds[kind] = twoWay(market); break;
		case 'totals': case 'set1Totals': odds[kind] = totalsOdds(market); break;
		case 'handicap': case 'setHandicap': case 'set1Handicap': odds[kind] = handicapOdds(market); break;
		case 'correctScore': odds.correctScore = correctScoreOdds(market, getCorrectScoresForSport(sport, tournament)); break;
		case 'setCount': odds.setCount = setCountOdds(market); break;
	}
	return odds;
};

// Preserve every provider market, including closed and unrecognised markets.
// Names remain a verified adapter; provider type IDs are retained for future mappings.
export const parseFixtureMarkets = (sport: Sport, markets: unknown[], tournament: string, capturedAt: string, eventTradable = true): FixtureMarket[] =>
	markets.map<FixtureMarket>((raw, index) => {
		const validated = marketSchema.safeParse(raw);
		if (!validated.success) {
			const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
			return { id: String(record.idfomarket ?? `invalid:${index}`), sourceTypeId: null, market: null, name: String(record.name ?? '未知市場'), line: null, isMainline: false,
				status: 'invalid', reason: '來源市場格式不符', bettingEndsAt: null, sourceState: null, bettingTypes: null, selections: [] };
		}
		const market = validated.data;
		const kind = classifyTslMarket(market.name).kind;
		const rows = fixtureOddsRows(parseMarketOdds(kind, market, sport, tournament), sport);
		const end = market.tsbetend && Number.isFinite(Date.parse(market.tsbetend)) ? new Date(market.tsbetend).toISOString() : null;
		let status: FixtureMarket['status'] = 'available';
		let reason: string | null = null;
		if (!eventTradable || market.istradable === false || market.selections.some(s => s.istradable === false) || (end && end <= capturedAt)) {
			status = 'unavailable'; reason = '已停賣、截止或選項暫停';
		} else if (market.tsbetend && !end) {
			status = 'invalid'; reason = '來源截止時間格式不符';
		} else if (kind === 'ignored' || (sport === 'badminton' && !BADMINTON_MARKETS.includes(kind))) {
			status = 'unsupported'; reason = '目前沒有這個玩法的模型';
		} else if (rows.length === 0) {
			status = 'invalid'; reason = '盤口或賠率格式不完整；目前只支援 .5 線';
		} else if (kind === 'correctScore' && rows.length !== getCorrectScoresForSport(sport, tournament).length) {
			status = 'invalid'; reason = '正確比數選項不完整';
		} else if (sport === 'badminton' && kind === 'setCount' && (rows.length !== 2 || !rows.some(r => r.outcomeKey === '2') || !rows.some(r => r.outcomeKey === '3'))) {
			status = 'invalid'; reason = '正確總局數需包含 2 局及 3 局';
		}
		const sourceFor = (key: string) => market.selections.find(s => {
			if (key === 'away' || key === 'home') return s.hadvalue === (key === 'away' ? 'A' : 'H');
			if (key === 'over' || key === 'under') return clean(s.name).startsWith(key === 'over' ? '大' : '小');
			return clean(s.name).replace(/[局盤]$/, '') === key;
		});
		return {
			id: market.idfomarket ?? `${kind}:${rows[0]?.line ?? ''}:${index}`,
			sourceTypeId: market.idfomarkettype ?? null,
			market: kind === 'ignored' ? null : kind,
			name: clean(market.name), line: rows[0]?.line ?? null,
			isMainline: market.ismainline ?? false, status, reason,
			bettingEndsAt: end, sourceState: market.idfobolifestate ?? null, bettingTypes: market.csvavailablebettypes ?? null,
			selections: rows.length ? rows.map(row => {
				const source = sourceFor(row.outcomeKey);
				return { id: source?.idfoselection ?? null, key: row.outcomeKey, label: source?.name ?? row.outcomeKey, odds: row.odds, sourceState: source?.idfobolifestate ?? null };
			}) : market.selections.map(s => ({ id: s.idfoselection ?? null, key: s.hadvalue ?? s.name, label: s.name, odds: selectionOdds(s), sourceState: s.idfobolifestate ?? null })),
		};
	});

export const fixtureOddsRows = (odds: FixtureOdds, sport: Sport = "badminton"): TslOddsRow[] => {
	const rows: TslOddsRow[] = [];
	if (odds.match) {
		rows.push({ market: "match", outcomeKey: "away", line: null, odds: odds.match.away });
		rows.push({ market: "match", outcomeKey: "home", line: null, odds: odds.match.home });
	}
	if (odds.set1) {
		rows.push({ market: "set1", outcomeKey: "away", line: null, odds: odds.set1.away });
		rows.push({ market: "set1", outcomeKey: "home", line: null, odds: odds.set1.home });
	}
	if (odds.totals) {
		rows.push({ market: "totals", outcomeKey: "over", line: odds.totals.line, odds: odds.totals.over });
		rows.push({ market: "totals", outcomeKey: "under", line: odds.totals.line, odds: odds.totals.under });
	}
	if (odds.handicap) {
		const awayLine = -odds.handicap.homeLine;
		rows.push({ market: "handicap", outcomeKey: "away", line: awayLine, odds: odds.handicap.away });
		rows.push({ market: "handicap", outcomeKey: "home", line: awayLine, odds: odds.handicap.home });
	}
	if (odds.correctScore) {
		const scores =
			sport === "volleyball"
				? VOLLEYBALL_CORRECT_SCORES
				: sport === "tennis"
					? [...TENNIS_BO3_CORRECT_SCORES, ...TENNIS_BO5_CORRECT_SCORES]
					: BADMINTON_CORRECT_SCORES;
		for (const score of scores) {
			const scoreOdds = odds.correctScore[score];
			if (scoreOdds !== undefined) {
				rows.push({ market: "correctScore", outcomeKey: score, line: null, odds: scoreOdds });
			}
		}
	}
	if (odds.setHandicap) {
		const awayLine = -odds.setHandicap.homeLine;
		rows.push({ market: "setHandicap", outcomeKey: "away", line: awayLine, odds: odds.setHandicap.away });
		rows.push({ market: "setHandicap", outcomeKey: "home", line: awayLine, odds: odds.setHandicap.home });
	}
	if (odds.set1Totals) {
		rows.push({ market: "set1Totals", outcomeKey: "over", line: odds.set1Totals.line, odds: odds.set1Totals.over });
		rows.push({ market: "set1Totals", outcomeKey: "under", line: odds.set1Totals.line, odds: odds.set1Totals.under });
	}
	if (odds.set1Handicap) {
		const awayLine = -odds.set1Handicap.homeLine;
		rows.push({ market: "set1Handicap", outcomeKey: "away", line: awayLine, odds: odds.set1Handicap.away });
		rows.push({ market: "set1Handicap", outcomeKey: "home", line: awayLine, odds: odds.set1Handicap.home });
	}
	if (odds.setCount) {
		for (const [key, value] of Object.entries(odds.setCount)) {
			if (value !== undefined) rows.push({ market: "setCount", outcomeKey: key, line: null, odds: value });
		}
	}
	return rows;
};

const toFixture = (event: TslEvent, sport: Sport, english: Map<string, z.infer<typeof englishSchema>>, capturedAt: string): TslFixture | string => {
	const tournament = clean(event.tournamentname);
	const discipline = tslDiscipline(sport, tournament);
	if (!discipline) {
		if (sport === "badminton") return "不是男單或女單";
		if (sport === "tennis") return "不是 ATP 或 WTA 單打";
		return "無法辨識男排或女排";
	}
	const sportradarId = sportradarMatchId(event.externalreference);
	if (sportradarId === null) return "沒有 Sportradar 場次編號";
	const names = english.get(event.idfoevent);
	if (!names) return "沒有英文隊伍名";
	const startsAt = new Date(event.tsstart);
	if (Number.isNaN(startsAt.getTime())) return "開賽時間無法解析";

	const markets = parseFixtureMarkets(sport, event.markets, tournament, new Date(capturedAt).toISOString(), event.istradable !== false);
	const odds = defaultFixtureOdds(markets);
	return {
		sport,
		tslEventId: event.idfoevent,
		sportradarId,
		discipline,
		tournament,
		startsAt: startsAt.toISOString(),
		awayName: clean(names.participantname_away),
		homeName: clean(names.participantname_home),
		awayNameZh: clean(event.participantname_away),
		homeNameZh: clean(event.participantname_home),
		markets,
		odds,
		rows: fixtureOddsRows(odds, sport),
		ignoredMarkets: markets.filter(m => m.status === 'unsupported' || m.status === 'invalid').map(m => `${m.name}（${m.reason}）`)
	};
};

export type TslParseOptions = {
	sports?: Sport[];
};

export const parseTslPayload = (payload: TslPayload, options: TslParseOptions = {}): TslParseResult => {
	const { sports = ["badminton", "volleyball", "tennis"] } = options;
	const english = new Map(payload.english.map((entry) => [entry.idfoevent, entry]));
	const fixtures: TslFixture[] = [];
	const skipped: TslParseResult["skipped"] = [];

	for (const raw of payload.events) {
		const parsed = eventSchema.safeParse(raw);
		if (!parsed.success) {
			const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
			const label = clean(`${record.participantname_away ?? ""} @ ${record.participantname_home ?? ""}`);
			const path = parsed.error.issues[0]?.path.filter((part) => part !== undefined).join(".") ?? "";
			skipped.push({
				name: label && label !== "@" ? label : "未知場次",
				reason: path ? `格式不符（${path}）` : "格式不符"
			});
			continue;
		}

		const sportCode = parsed.data.idfosporttype;
		const sport = getSportByTslCode(sportCode);

		if (!sport) {
			skipped.push({
				name: clean(`${parsed.data.participantname_away} @ ${parsed.data.participantname_home}`),
				reason: `未知運動代碼 ${sportCode}`
			});
			continue;
		}
		if (!sports.includes(sport)) continue;

		const result = toFixture(parsed.data, sport, english, payload.capturedAt);
		if (typeof result !== "string") {
			fixtures.push(result);
			continue;
		}
		skipped.push({
			name: clean(`${parsed.data.participantname_away} @ ${parsed.data.participantname_home}`),
			reason: result
		});
	}
	return { fixtures, skipped };
};

export const parseBadmintonPayload = (payload: TslPayload): TslParseResult => parseTslPayload(payload, { sports: ["badminton"] });

export const parseVolleyballPayload = (payload: TslPayload): TslParseResult => parseTslPayload(payload, { sports: ["volleyball"] });

export const parseTennisPayload = (payload: TslPayload): TslParseResult => parseTslPayload(payload, { sports: ["tennis"] });
