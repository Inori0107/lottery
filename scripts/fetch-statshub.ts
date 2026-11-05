import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sport } from "../shared/sports";
import {
	STATSHUB_SOURCE_URL,
	STATSHUB_START_DATE,
	VOLLEYBALL_STATSHUB_SOURCE_URL,
	VOLLEYBALL_STATSHUB_START_DATE,
	FOOTBALL_STATSHUB_SOURCE_URL,
	FOOTBALL_STATSHUB_START_DATE
} from "../server/models/constants";
import { taipeiDate } from "../server/models/ledgerStore";
import { parseStatshubPage } from "../server/models/statshub";
import {
	fetchStatshubHtmlWithRetry,
	STATSHUB_REQUEST_GAP_MS as REQUEST_GAP_MS,
	loadFailedDates,
	saveFailedDates,
	recordFailedDate,
	clearFailedDate,
	getFailedDatesForSport,
	type FailedDatesStore,
	type FetchResult,
} from "../server/models/statshubLoader";
import { root, statshubDir, volleyballStatshubDir, footballStatshubDir } from "./paths";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type FetchSummary = {
	sport: string;
	label: string;
	available: number;
	downloaded: number;
	skipped: number;
	failed: string[];
	latestDate: string | null;
};

const fetchPage = async (date: string, sourceUrl: string): Promise<FetchResult<string>> => {
	return fetchStatshubHtmlWithRetry(date, sourceUrl);
};

const savePage = (pageDir: string, date: string, html: string, hasLiveMatch: boolean) => {
	if (hasLiveMatch) {
		return { saved: false, reason: "live" as const };
	}
	writeFileSync(join(pageDir, `${date}.html`), html);
	return { saved: true, reason: null };
};

const fetchSport = async (
	sourceUrl: string,
	pageDir: string,
	sport: Sport,
	startDate: string,
	label: string,
	failedStore: FailedDatesStore,
): Promise<FetchSummary> => {
	mkdirSync(pageDir, { recursive: true });
	const today = taipeiDate(new Date());
	const yesterday = taipeiDate(new Date(Date.now() - 86_400_000));
	const cached = new Set(
		readdirSync(pageDir)
			.filter((file) => file.endsWith(".html"))
			.map((file) => file.replace(/\.html$/, ""))
	);

	const summary: FetchSummary = {
		sport,
		label,
		available: 0,
		downloaded: 0,
		skipped: 0,
		failed: [],
		latestDate: null,
	};

	const indexResult = await fetchPage(yesterday, sourceUrl);
	if (!indexResult.ok) {
		console.error(`${label}無法取得索引頁（${yesterday}）：${indexResult.error.message}`);
		summary.failed.push(yesterday);
		recordFailedDate(failedStore, sport, yesterday, indexResult.error.message);
		return summary;
	}

	const index = parseStatshubPage(indexResult.data, sport);
	summary.available = index.validDates.length;

	if (!cached.has(yesterday) && index.validDates.includes(yesterday)) {
		const saveResult = savePage(pageDir, yesterday, indexResult.data, index.hasLiveMatch);
		if (saveResult.saved) {
			cached.add(yesterday);
			summary.downloaded++;
		}
	}

	const previouslyFailed = getFailedDatesForSport(failedStore, sport);
	const pendingFromFailed = previouslyFailed.filter(
		(date) => date >= startDate && date < today && !cached.has(date) && index.validDates.includes(date)
	);

	const pendingFromIndex = index.validDates.filter(
		(date) => date >= startDate && date < today && !cached.has(date)
	);

	const pending = [...new Set([...pendingFromFailed, ...pendingFromIndex])].sort();

	console.log(
		`${label}可用日期 ${index.validDates.length} 天，本機已有 ${cached.size} 天，待下載 ${pending.length} 天` +
		(pendingFromFailed.length > 0 ? `（含重試 ${pendingFromFailed.length} 天）` : "")
	);

	for (const date of pending) {
		await wait(REQUEST_GAP_MS);
		const result = await fetchPage(date, sourceUrl);

		if (!result.ok) {
			const errorMsg = result.error.type === "nodata"
				? `無資料（404）`
				: result.error.type === "network"
					? `網路錯誤：${result.error.message}`
					: `HTTP ${result.error.status}`;

			console.log(`${label}${date}：${errorMsg}，略過`);
			summary.failed.push(date);

			if (result.error.type === "nodata") {
				summary.skipped++;
			} else {
				recordFailedDate(failedStore, sport, date, errorMsg);
			}
			continue;
		}

		const page = parseStatshubPage(result.data, sport);
		const saveResult = savePage(pageDir, date, result.data, page.hasLiveMatch);

		if (saveResult.saved) {
			summary.downloaded++;
			clearFailedDate(failedStore, sport, date);
			console.log(`${label}${date}：${page.matches.length} 場`);
		} else {
			console.log(`${label}${date}：${page.matches.length} 場（進行中，不存檔）`);
			summary.skipped++;
		}
	}

	const allCached = [...cached].sort();
	summary.latestDate = allCached.length > 0 ? allCached[allCached.length - 1]! : null;

	return summary;
};

const printSummary = (summaries: FetchSummary[], failedStore: FailedDatesStore) => {
	console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	console.log("抓取摘要");
	console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

	for (const s of summaries) {
		console.log(`\n${s.label.trim()}`);
		console.log(`  可用：${s.available} 天`);
		console.log(`  本次下載：${s.downloaded} 天`);
		if (s.skipped > 0) console.log(`  略過（進行中/無資料）：${s.skipped} 天`);
		if (s.latestDate) console.log(`  最新已存檔日期：${s.latestDate}（不含進行中比賽）`);
	}

	const totalFailed = Object.entries(failedStore);
	if (totalFailed.length > 0) {
		console.log("\n待重試（下次執行會自動重試）：");
		for (const [sport, dates] of totalFailed) {
			const dateList = Object.keys(dates).sort();
			if (dateList.length > 0) {
				console.log(`  ${sport}：${dateList.length} 天 - ${dateList.slice(0, 5).join(", ")}${dateList.length > 5 ? "..." : ""}`);
			}
		}
	}

	console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};

const main = async () => {
	const failedStore = loadFailedDates(root);

	const summaries: FetchSummary[] = [];

	summaries.push(
		await fetchSport(STATSHUB_SOURCE_URL, statshubDir, "badminton", STATSHUB_START_DATE, "羽球 ", failedStore)
	);
	summaries.push(
		await fetchSport(VOLLEYBALL_STATSHUB_SOURCE_URL, volleyballStatshubDir, "volleyball", VOLLEYBALL_STATSHUB_START_DATE, "排球 ", failedStore)
	);
	summaries.push(
		await fetchSport(FOOTBALL_STATSHUB_SOURCE_URL, footballStatshubDir, "football", FOOTBALL_STATSHUB_START_DATE, "足球 ", failedStore)
	);

	saveFailedDates(root, failedStore);
	printSummary(summaries, failedStore);
};

main().catch((error) => {
	console.error("抓取失敗：", error);
	process.exit(1);
});
