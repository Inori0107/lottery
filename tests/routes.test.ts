import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS, PUBLIC_GET_API_ROUTES, PUBLIC_PAGE_ROUTES, SPORT_BASE_PATH, SPORT_NAV_LINKS, pageFilesForRoute, sportFromPath } from "../shared/nav";
import { SPORTS } from "../shared/sports";
import { buildTslBookmarklet } from "../app/utils/tslBookmarklet";

describe("運動導覽路由", () => {
	it("各球種導覽列都是計算、投注、同步、賽事，路徑掛在該球種子路徑下", () => {
		for (const sport of SPORTS) {
			const base = SPORT_BASE_PATH[sport];
			expect(SPORT_NAV_LINKS[sport].map((link) => link.label)).toEqual(["計算", "投注紀錄", "賠率同步", "已匯入賽事"]);
			expect(SPORT_NAV_LINKS[sport].map((link) => link.to)).toEqual([base, `${base}/bets`, `${base}/tsl-sync`, `${base}/matches`]);
		}
	});

	it("公開頁面都有對應的 Vue 檔", () => {
		const missing = PUBLIC_PAGE_ROUTES.filter((route) => pageFilesForRoute(route).every((file) => !existsSync(file)));
		expect(missing).toEqual([]);
	});

	it("sportFromPath 依子路徑判斷運動，首頁與全域同步不是羽球", () => {
		expect(sportFromPath("/")).toBeNull();
		expect(sportFromPath("/sport")).toBeNull();
		expect(sportFromPath("/tsl-sync")).toBeNull();
		expect(sportFromPath("/bets")).toBeNull();
		expect(sportFromPath("/badminton")).toBe("badminton");
		expect(sportFromPath("/badminton/bets")).toBe("badminton");
		expect(sportFromPath("/volleyball")).toBe("volleyball");
		expect(sportFromPath("/tennis")).toBe("tennis");
		expect(sportFromPath("/tennis/bets")).toBe("tennis");
	});

	it("舊路徑轉到選擇運動或羽球子路徑", () => {
		expect(LEGACY_REDIRECTS).toEqual({
			"/sport": "/",
			"/bets": "/badminton/bets",
			"/matches": "/badminton/matches",
		});
	});

	it("書籤小工具會抓羽球、排球與網球，並開全域 /tsl-sync", () => {
		const source = decodeURIComponent(buildTslBookmarklet("http://localhost:3000"));
		expect(source).toContain("BAD");
		expect(source).toContain("VOL");
		expect(source).toContain("VOLL");
		expect(source).toContain("VBL");
		expect(source).not.toContain("SPORT_CODES.includes(event.idfosporttype)");
		expect(source).toContain("TENN");
		expect(source).toContain("TNS");
		expect(source).toContain("/tsl-sync");
		expect(source).toContain("tsl-status");
		expect(source).not.toContain("event.source");
		expect(source).not.toContain("/tennis/tsl-sync");
		expect(source).not.toContain("/badminton/tsl-sync");
	});

	it("GET API 清單涵蓋羽球、排球與網球", () => {
		expect(PUBLIC_GET_API_ROUTES).toContain("/api/status");
		expect(PUBLIC_GET_API_ROUTES.some((route) => route.startsWith("/api/volleyball"))).toBe(true);
		expect(PUBLIC_GET_API_ROUTES).toContain("/api/matches?sport=volleyball");
		expect(PUBLIC_GET_API_ROUTES).toContain("/api/matches?sport=tennis");
		expect(PUBLIC_GET_API_ROUTES.some((route) => route.startsWith("/api/tennis"))).toBe(true);
		expect(PUBLIC_GET_API_ROUTES).toContain("/api/tickets");
		expect(PUBLIC_GET_API_ROUTES).toContain("/api/bankroll");
	});
});
