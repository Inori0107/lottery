import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/open";
import { openLedger } from "../server/db/ledger";
import { createPlayerLinker, ensureTennisPlayersFromMatches, ensureVolleyballTeamsFromMatches, fixtureIdsNeedingMatchPage, listFixtures, readTodayFixtures, taipeiDate } from "../server/models/ledgerStore";

const MAIN_SCHEMA = `
CREATE TABLE players (
  player_id TEXT PRIMARY KEY,
  name_primary TEXT NOT NULL,
  name_aliases TEXT NOT NULL DEFAULT ''
);
CREATE TABLE player_ratings (
  discipline TEXT NOT NULL,
  player_id TEXT NOT NULL,
  elo REAL NOT NULL,
  match_count INTEGER NOT NULL,
  game1_count INTEGER NOT NULL,
  last_played_on TEXT,
  game1_recent TEXT NOT NULL,
  PRIMARY KEY (discipline, player_id)
);
CREATE TABLE model_state (
  discipline TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  game1_method TEXT NOT NULL,
  payload TEXT NOT NULL,
  data_through TEXT NOT NULL
);
`;

const seedMainRatings = (sqlite: InstanceType<typeof Database>) => {
	sqlite.exec(`
    INSERT INTO players (player_id, name_primary) VALUES ('p-away', 'Viktor AXELSEN');
    INSERT INTO players (player_id, name_primary) VALUES ('p-home', 'Christo POPOV');
    INSERT INTO player_ratings (discipline, player_id, elo, match_count, game1_count, last_played_on, game1_recent)
    VALUES
      ('MS', 'p-away', 2400, 20, 18, '2026-10-01', '[]'),
      ('MS', 'p-home', 2100, 15, 12, '2026-10-01', '[]');
  `);
};

const seedTodayFixture = (
	ledger: InstanceType<typeof Database>,
	date: string,
	extra: {
		sportradarId?: number;
		discipline?: string;
		awayPlayerId?: string | null;
		homePlayerId?: string | null;
	} = {}
) => {
	ledger
		.prepare(
			`
    INSERT INTO fixtures (
      sportradar_id, tsl_event_id, discipline, tournament, starts_at, play_date,
      away_name, home_name, away_player_id, home_player_id, updated_at
    ) VALUES (?, 'e1', ?, 'Test Open', ?, ?, 'Away', 'Home', ?, ?, ?)
  `
		)
		.run(
			extra.sportradarId ?? 101,
			extra.discipline ?? "MS",
			`${date}T02:00:00.000Z`,
			date,
			extra.awayPlayerId ?? "p-away",
			extra.homePlayerId ?? "p-home",
			new Date().toISOString()
		);
};

describe("今日對局相容舊羽球資料庫", () => {
	it("main 的 game1_count 庫在切到此分支後，listFixtures 不會因欄位名 500", () => {
		const main = new Database(":memory:");
		main.exec(MAIN_SCHEMA);
		seedMainRatings(main);
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-"));
		const ledger = openLedger(join(dir, "ledger.sqlite"));
		const date = taipeiDate(new Date());
		seedTodayFixture(ledger, date);

		expect(() => listFixtures(ledger, main, date)).not.toThrow();
		const fixtures = listFixtures(ledger, main, date);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0]?.away).toMatchObject({ id: "p-away", name: "Viktor AXELSEN", set1Count: 18 });
		expect(fixtures[0]?.home).toMatchObject({ id: "p-home", set1Count: 12 });

		const payload = readTodayFixtures(ledger, main, (fixture) => fixture.discipline === "MS");
		expect(payload.message).toBeNull();
		expect(payload.fixtures).toHaveLength(1);

		main.close();
		ledger.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("openDatabase 遷移舊庫後，羽球與排球 fixtures 讀取都不會丟例外", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-open-"));
		const dbFile = join(dir, "badminton.sqlite");
		const raw = new Database(dbFile);
		raw.exec(MAIN_SCHEMA);
		seedMainRatings(raw);
		raw.close();

		const { sqlite } = openDatabase(dbFile);
		const columns = (sqlite.prepare("PRAGMA table_info(player_ratings)").all() as Array<{ name: string }>).map((column) => column.name);
		expect(columns).toContain("set1_count");
		expect(columns).not.toContain("game1_count");

		const ledger = openLedger(join(dir, "ledger.sqlite"));
		const date = taipeiDate(new Date());
		seedTodayFixture(ledger, date, { sportradarId: 1, discipline: "MS" });
		seedTodayFixture(ledger, date, { sportradarId: 2, discipline: "M", awayPlayerId: null, homePlayerId: null });
		const badminton = readTodayFixtures(ledger, sqlite, (fixture) => fixture.discipline === "MS" || fixture.discipline === "WS");
		const volleyball = readTodayFixtures(ledger, sqlite, (fixture) => fixture.discipline === "M" || fixture.discipline === "W");

		expect(badminton.message).toBeNull();
		expect(volleyball.message).toBeNull();
		expect(badminton.fixtures).toHaveLength(1);
		expect(badminton.fixtures[0]?.away?.set1Count).toBe(18);
		expect(volleyball.fixtures).toHaveLength(1);

		sqlite.close();
		ledger.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("排球隊伍用隊名對上 volleyball_teams", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-vb-"));
		const { sqlite } = openDatabase(join(dir, "app.sqlite"));
		sqlite.exec(`
      INSERT INTO volleyball_teams (team_id, name_primary, name_aliases) VALUES ('sportradar:1', 'Cruzeiro', 'Cruzeiro Volei');
      INSERT INTO volleyball_team_ratings (discipline, team_id, elo, match_count, set1_count, last_played_on, set1_recent)
      VALUES ('M', 'sportradar:1', 1600, 12, 12, '2026-10-01', '[]');
    `);
		const link = createPlayerLinker(sqlite);
		expect(link("M", ["Cruzeiro"], null)).toBe("sportradar:1");
		expect(link("M", ["Cruzeiro Volei"], 1)).toBe("sportradar:1");
		expect(link("MS", ["Cruzeiro"], null)).toBeNull();
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("單場頁隊伍寫入排球資料庫後可用 uid 對上", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-vb-match-"));
		const { sqlite } = openDatabase(join(dir, "app.sqlite"));
		const added = ensureVolleyballTeamsFromMatches(sqlite, [
			{
				sportradarId: 91000001,
				playedOn: "2026-10-27",
				startsAt: "2026-10-27T22:00:00.000Z",
				discipline: "M",
				tournament: "Superliga 2026",
				round: "",
				status: "pre",
				played: false,
				live: false,
				home: { uid: 88, name: "Suzano" },
				away: { uid: 77, name: "Goias" },
				winner: "",
				score: "",
				games: []
			}
		]);
		expect(added).toBe(2);
		const link = createPlayerLinker(sqlite);
		expect(link("M", ["Goias"], 77)).toBe("sportradar:77");
		expect(link("M", ["Suzano"], 88)).toBe("sportradar:88");
		expect(link("W", ["Suzano"], 88)).toBeNull();
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("網球 WTA 場次可對上只存在 ATP 評分的選手", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-tn-"));
		const { sqlite } = openDatabase(join(dir, "app.sqlite"));
		sqlite.exec(`
      INSERT INTO tennis_players (player_id, name_primary) VALUES ('sportradar:99131', 'Bucsa, Cristina');
      INSERT INTO tennis_player_ratings (discipline, player_id, elo, match_count, set1_count, last_played_on, set1_recent)
      VALUES ('ATP', 'sportradar:99131', 1600, 2, 2, '2026-10-01', '[]');
    `);
		const link = createPlayerLinker(sqlite);
		expect(link("WTA", ["Bucsa, Cristina"], null)).toBe("sportradar:99131");
		expect(link("ATP", ["Bucsa, Cristina"], null)).toBe("sportradar:99131");
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("明天未對上的場次也會抓單場頁", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-tomorrow-"));
		const ledger = openLedger(join(dir, "ledger.sqlite"));
		const today = taipeiDate(new Date());
		const tomorrow = taipeiDate(new Date(Date.now() + 36e5 * 24));
		seedTodayFixture(ledger, tomorrow, { sportradarId: 75838032, discipline: "WTA", awayPlayerId: null, homePlayerId: null });
		expect(fixtureIdsNeedingMatchPage(ledger, today, new Set())).toContain(75838032);
		ledger.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("單場頁選手寫入網球資料庫後可用 uid 對上", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-tn-match-"));
		const { sqlite } = openDatabase(join(dir, "app.sqlite"));
		const added = ensureTennisPlayersFromMatches(sqlite, [
			{
				sportradarId: 75838032,
				playedOn: "2026-10-28",
				startsAt: "2026-10-28T02:40:00.000Z",
				discipline: "WTA",
				tournament: "WTA Tokyo 2026",
				round: "R16",
				status: "pre",
				played: false,
				live: false,
				home: { uid: 99131, name: "Bucsa, Cristina" },
				away: { uid: 776340, name: "Joint, Maya" },
				winner: "",
				score: "",
				games: []
			}
		]);
		expect(added).toBe(2);
		expect(ensureTennisPlayersFromMatches(sqlite, [
			{
				sportradarId: 75838032,
				playedOn: "2026-10-28",
				startsAt: "2026-10-28T02:40:00.000Z",
				discipline: "WTA",
				tournament: "WTA Tokyo 2026",
				round: "R16",
				status: "pre",
				played: false,
				live: false,
				home: { uid: 99131, name: "Bucsa, Cristina" },
				away: { uid: 776340, name: "Joint, Maya" },
				winner: "",
				score: "",
				games: []
			}
		])).toBe(0);
		const link = createPlayerLinker(sqlite);
		expect(link("WTA", ["Joint, Maya"], 776340)).toBe("sportradar:776340");
		expect(link("WTA", ["Bucsa, Cristina"], 99131)).toBe("sportradar:99131");
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("主資料庫或 fixtures 表缺失時回傳說明，不丟例外", () => {
		const dir = mkdtempSync(join(tmpdir(), "lottery-fx-empty-"));
		const empty = new Database(":memory:");
		const brokenLedger = new Database(":memory:");
		const payload = readTodayFixtures(brokenLedger, empty, () => true);
		expect(payload.fixtures).toEqual([]);
		expect(payload.message).toContain("資料庫");

		const missingRatings = new Database(":memory:");
		missingRatings.exec("CREATE TABLE players (player_id TEXT PRIMARY KEY, name_primary TEXT)");
		const ledger = openLedger(join(dir, "ledger.sqlite"));
		const date = taipeiDate(new Date());
		seedTodayFixture(ledger, date, { awayPlayerId: null, homePlayerId: null });
		const listed = listFixtures(ledger, missingRatings, date);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.away).toBeNull();

		empty.close();
		brokenLedger.close();
		missingRatings.close();
		ledger.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
