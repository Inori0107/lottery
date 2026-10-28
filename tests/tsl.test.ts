import { describe, expect, it } from "vitest";
import sample from "../data/raw/tsl/sample.json";
import {
	classifyTslMarket,
	fixtureOddsRows,
	fractionalToDecimal,
	parseTslPayload,
	sportradarMatchId,
	tslDiscipline,
	tslPayloadSchema
} from "../server/models/tsl";

const parsedSample = () => parseTslPayload(tslPayloadSchema.parse(sample));

describe("TSL helpers", () => {
	it("converts fractional prices to rounded decimal odds", () => {
		expect(fractionalToDecimal("17", "10")).toBe(2.7);
		expect(fractionalToDecimal("1", "4")).toBe(1.25);
		expect(fractionalToDecimal("0", "4")).toBeNull();
		expect(fractionalToDecimal(null, "4")).toBeNull();
	});

	it("reads the Sportradar match id from the external reference", () => {
		expect(sportradarMatchId("sr:match:75825222")).toBe(75825222);
		expect(sportradarMatchId("betradar:75825222")).toBeNull();
		expect(sportradarMatchId(null)).toBeNull();
	});

	it("classifies synced TSL market names instead of a fixed list", () => {
		expect(classifyTslMarket("正確總局數")).toEqual({ kind: "setCount", name: "正確總局數" });
		expect(classifyTslMarket("[第1局]讓分 -3.5")).toEqual({ kind: "set1Handicap", name: "[第1局]讓分 -3.5" });
		expect(classifyTslMarket("[第1盤]大小 46.5")).toEqual({ kind: "set1Totals", name: "[第1盤]大小 46.5" });
		expect(classifyTslMarket("單雙")).toEqual({ kind: "ignored", name: "單雙" });
	});

	it("maps Chinese tournament names to singles disciplines", () => {
		expect(tslDiscipline("badminton", "法國公開賽男子單打")).toBe("MS");
		expect(tslDiscipline("badminton", "法國公開賽女子單打")).toBe("WS");
		expect(tslDiscipline("badminton", "法國公開賽男子雙打")).toBeNull();
		expect(tslDiscipline("volleyball", "義大利甲級聯賽男子排球")).toBe("M");
		expect(tslDiscipline("volleyball", "義大利甲級女子排球")).toBe("W");
		expect(tslDiscipline("volleyball", "Superliga | Brazil")).toBe("M");
		expect(tslDiscipline("volleyball", "Superliga, Women | Brazil")).toBe("W");
		expect(tslDiscipline("volleyball", "沙灘排球")).toBeNull();
		expect(tslDiscipline("tennis", "ATP 500 男單")).toBe("ATP");
		expect(tslDiscipline("tennis", "WTA 1000 女單")).toBe("WTA");
		expect(tslDiscipline("tennis", "ATP 雙打")).toBeNull();
		expect(tslDiscipline("tennis", "WTA 混雙")).toBeNull();
		expect(tslDiscipline("badminton", "French Open, MD")).toBeNull();
	});

	it("網球讓盤與正確總盤數別名", () => {
		expect(classifyTslMarket("讓盤 -1.5")).toEqual({ kind: "setHandicap", name: "讓盤 -1.5" });
		expect(classifyTslMarket("盤數讓分 -1.5")).toEqual({ kind: "setHandicap", name: "盤數讓分 -1.5" });
		expect(classifyTslMarket("讓局 -3.5")).toEqual({ kind: "handicap", name: "讓局 -3.5" });
		expect(classifyTslMarket("正確盤數")).toEqual({ kind: "correctScore", name: "正確盤數" });
		expect(classifyTslMarket("正確總盤數")).toEqual({ kind: "setCount", name: "正確總盤數" });
		expect(classifyTslMarket("[總局數]大小 22.5")).toEqual({ kind: "totals", name: "[總局數]大小 22.5" });
	});
});

describe("parseTslPayload", () => {
	it("parses every singles event in the captured sample", () => {
		const { fixtures, skipped } = parsedSample();
		expect(fixtures).toHaveLength(13);
		expect(skipped).toEqual([]);
	});

	it("keeps away and home orientation and all markets", () => {
		const fixture = parsedSample().fixtures.find((item) => item.sportradarId === 75825222);
		expect(fixture).toMatchObject({
			tslEventId: "3500901.1",
			discipline: "WS",
			startsAt: "2026-10-22T10:50:00.000Z",
			awayName: "Blichfeldt, Mia",
			homeName: "Han, Yue",
			awayNameZh: "布里西費爾特",
			homeNameZh: "韓悅"
		});
		expect(fixture?.odds).toEqual({
			match: { away: 2.7, home: 1.25 },
			set1: { away: 2.3, home: 1.35 },
			totals: { line: 76.5, over: 1.68, under: 1.75 },
			handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
			correctScore: { "2:0": 4.85, "2:1": 5.65, "1:2": 3.05, "0:2": 1.7 },
			setHandicap: null,
			set1Totals: null,
			set1Handicap: { homeLine: -3.5, away: 1.65, home: 1.78 },
			setCount: { "2": 1.4, "3": 2.2 }
		});
		expect(fixture?.ignoredMarkets).toEqual([]);
	});

	it("stores handicap rows with the away line", () => {
		const rows = fixtureOddsRows({
			match: null,
			set1: null,
			totals: null,
			handicap: { homeLine: -8.5, away: 1.7, home: 1.73 },
			correctScore: null,
			setHandicap: null,
			set1Totals: null,
			set1Handicap: null,
			setCount: null
		});
		expect(rows).toEqual([
			{ market: "handicap", outcomeKey: "away", line: 8.5, odds: 1.7 },
			{ market: "handicap", outcomeKey: "home", line: 8.5, odds: 1.73 }
		]);
	});

	it("skips events without a Sportradar reference", () => {
		const [first] = sample.events;
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				...sample,
				events: [{ ...first, externalreference: null }]
			})
		);
		expect(fixtures).toEqual([]);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]?.reason).toBe("沒有 Sportradar 場次編號");
	});

	it("未知運動代碼會記進 skipped", () => {
		const [first] = sample.events;
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				...sample,
				events: [{ ...first, idfosporttype: "XYZ" }]
			})
		);
		expect(fixtures).toEqual([]);
		expect(skipped[0]?.reason).toBe("未知運動代碼 XYZ");
	});

	it("解析排球 VBL 場次", () => {
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				capturedAt: "2026-10-27T00:00:00.000Z",
				date: "20261027",
				english: [
					{
						idfoevent: "vbl1",
						participantname_away: "Goias",
						participantname_home: "Suzano"
					}
				],
				events: [
					{
						idfoevent: "vbl1",
						idfosporttype: "VBL",
						participantname_away: "戈亞斯",
						participantname_home: "蘇紮諾",
						tsstart: "2026-10-27T22:00:00.000Z",
						tournamentname: "巴西超級聯賽",
						externalreference: "sr:match:91000001",
						markets: [
							{
								name: "不讓分",
								istradable: true,
								ismainline: true,
								selections: [
									{ name: "客", hadvalue: "A", currentpriceup: 6, currentpricedown: 5 },
									{ name: "主", hadvalue: "H", currentpriceup: 4, currentpricedown: 5 }
								]
							}
						]
					}
				]
			})
		);
		expect(skipped).toEqual([]);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0]).toMatchObject({
			sport: "volleyball",
			discipline: "M",
			awayName: "Goias",
			homeName: "Suzano"
		});
	});

	it("解析排球 VOL / VOLL 場次", () => {
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				capturedAt: "2026-10-26T00:00:00.000Z",
				date: "20261026",
				english: [
					{
						idfoevent: "v1",
						participantname_away: "Cruzeiro",
						participantname_home: "Renata"
					}
				],
				events: [
					{
						idfoevent: "v1",
						idfosporttype: "VOLL",
						participantname_away: "克魯塞羅",
						participantname_home: "雷納塔",
						tsstart: "2026-10-26T18:00:00.000Z",
						tournamentname: "巴西超級聯賽",
						externalreference: "sr:match:90000001",
						markets: [
							{
								name: "不讓分",
								istradable: true,
								ismainline: true,
								selections: [
									{ name: "客", hadvalue: "A", currentpriceup: "6", currentpricedown: "5" },
									{ name: "主", hadvalue: "H", currentpriceup: "4", currentpricedown: "5" }
								]
							}
						]
					}
				]
			})
		);
		expect(skipped).toEqual([]);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0]).toMatchObject({
			sport: "volleyball",
			discipline: "M",
			awayName: "Cruzeiro",
			homeName: "Renata"
		});
	});

	it("解析網球 TENN 場次", () => {
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				capturedAt: "2026-10-26T00:00:00.000Z",
				date: "20261026",
				english: [
					{
						idfoevent: "t1",
						participantname_away: "Sinner, Jannik",
						participantname_home: "Alcaraz, Carlos"
					}
				],
				events: [
					{
						idfoevent: "t1",
						idfosporttype: "TENN",
						participantname_away: "辛納",
						participantname_home: "阿爾卡拉斯",
						tsstart: "2026-10-26T18:00:00.000Z",
						tournamentname: "ATP 500 維也納",
						externalreference: "sr:match:90000002",
						markets: [
							{
								name: "不讓分",
								istradable: true,
								ismainline: true,
								selections: [
									{ name: "客", hadvalue: "A", currentpriceup: "6", currentpricedown: "5" },
									{ name: "主", hadvalue: "H", currentpriceup: "4", currentpricedown: "5" }
								]
							}
						]
					}
				]
			})
		);
		expect(skipped).toEqual([]);
		expect(fixtures).toHaveLength(1);
		expect(fixtures[0]).toMatchObject({
			sport: "tennis",
			discipline: "ATP",
			awayName: "Sinner, Jannik",
			homeName: "Alcaraz, Carlos"
		});
	});

	it("網球 TNS 代碼也會當成 tennis", () => {
		const { fixtures, skipped } = parseTslPayload(
			tslPayloadSchema.parse({
				capturedAt: "2026-10-26T00:00:00.000Z",
				date: "20261026",
				english: [
					{
						idfoevent: "t2",
						participantname_away: "Sinner, Jannik",
						participantname_home: "Alcaraz, Carlos"
					}
				],
				events: [
					{
						idfoevent: "t2",
						idfosporttype: "TNS",
						participantname_away: "辛納",
						participantname_home: "阿爾卡拉斯",
						tsstart: "2026-10-26T18:00:00.000Z",
						tournamentname: "ATP 500 維也納",
						externalreference: "sr:match:90000003",
						markets: [
							{
								name: "不讓分",
								istradable: true,
								ismainline: true,
								selections: [
									{ name: "客", hadvalue: "A", currentpriceup: "6", currentpricedown: "5" },
									{ name: "主", hadvalue: "H", currentpriceup: "4", currentpricedown: "5" }
								]
							}
						]
					}
				]
			})
		);
		expect(skipped).toEqual([]);
		expect(fixtures[0]?.sport).toBe("tennis");
	});
});
