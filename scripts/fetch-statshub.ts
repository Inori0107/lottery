import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sport } from "../shared/sports";
import {
	STATSHUB_SOURCE_URL,
	STATSHUB_START_DATE,
	TENNIS_STATSHUB_SOURCE_URL,
	TENNIS_STATSHUB_START_DATE,
	VOLLEYBALL_STATSHUB_SOURCE_URL,
	VOLLEYBALL_STATSHUB_START_DATE
} from "../server/models/constants";
import { taipeiDate } from "../server/models/ledgerStore";
import { parseStatshubPage } from "../server/models/statshub";
import { fetchStatshubHtml, STATSHUB_REQUEST_GAP_MS as REQUEST_GAP_MS } from "../server/models/statshubLoader";
import { statshubDir, tennisStatshubDir, volleyballStatshubDir } from "./paths";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchPage = async (date: string, sourceUrl: string, sport: Sport) => {
	const html = await fetchStatshubHtml(date, sourceUrl);
	return { html, page: parseStatshubPage(html, sport) };
};

const savePage = (pageDir: string, date: string, html: string, hasLiveMatch: boolean) => {
	if (hasLiveMatch) {
		console.log(`${date}：仍有進行中的比賽，不存檔`);
		return false;
	}
	writeFileSync(join(pageDir, `${date}.html`), html);
	return true;
};

const fetchSport = async (sourceUrl: string, pageDir: string, sport: Sport, startDate: string, label: string) => {
	mkdirSync(pageDir, { recursive: true });
	const today = taipeiDate(new Date());
	const yesterday = taipeiDate(new Date(Date.now() - 86_400_000));
	const cached = new Set(
		readdirSync(pageDir)
			.filter((file) => file.endsWith(".html"))
			.map((file) => file.replace(/\.html$/, ""))
	);

	const index = await fetchPage(yesterday, sourceUrl, sport);
	if (!cached.has(yesterday) && index.page.validDates.includes(yesterday)) {
		if (savePage(pageDir, yesterday, index.html, index.page.hasLiveMatch)) cached.add(yesterday);
	}

	const pending = index.page.validDates.filter((date) => date >= startDate && date < today && !cached.has(date)).sort();
	console.log(`${label}可用日期 ${index.page.validDates.length} 天，待下載 ${pending.length} 天`);

	for (const date of pending) {
		await wait(REQUEST_GAP_MS);
		const { html, page } = await fetchPage(date, sourceUrl, sport);
		savePage(pageDir, date, html, page.hasLiveMatch);
		console.log(`${label}${date}：${page.matches.length} 場`);
	}
};

await fetchSport(STATSHUB_SOURCE_URL, statshubDir, "badminton", STATSHUB_START_DATE, "羽球 ");
await fetchSport(VOLLEYBALL_STATSHUB_SOURCE_URL, volleyballStatshubDir, "volleyball", VOLLEYBALL_STATSHUB_START_DATE, "排球 ");
await fetchSport(TENNIS_STATSHUB_SOURCE_URL, tennisStatshubDir, "tennis", TENNIS_STATSHUB_START_DATE, "網球 ");
