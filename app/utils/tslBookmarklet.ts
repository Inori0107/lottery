import { tslSportCodes } from "../../shared/sports";

export const TSL_ORIGIN = "https://www-talo-ssb-pr.sportslottery.com.tw";

export const TSL_IMPORT_CHANNEL = "lottery-tsl-import";

export type TslSyncMessage =
	| { type: "tsl-ready" }
	| { type: "tsl-payload"; payload: Record<string, unknown> }
	| { type: "tsl-status"; message: string }
	| { type: "tsl-error"; message: string };

const tslCollector = (appOrigin: string, sportsbookOrigin: string, sportCodes: string[]) => {
	type SyncHandle = {
		isAlive: () => boolean;
		isRunning: () => boolean;
		stop: () => void;
		run: () => Promise<void>;
	};
	type SyncWindow = Window & { __lotteryTslSync?: SyncHandle };
	type TslEvent = {
		idfoevent: string;
		idfosporttype?: string;
		idfosport?: string;
		tsstart: string;
		participantname_away: string;
		participantname_home: string;
	};
	type NavigationNode = {
		idfwbonavigation: string;
		focontentid?: string;
		name?: string;
		description?: string;
		foname?: string;
		numevents?: string;
		idfwbonavigationtypes?: string[];
		bonavigationnodes?: NavigationNode[];
		marketgroups?: Array<{ idfwmarketgroup: string; idfwmarketgrouptype: string }>;
	};
	const page = window as SyncWindow;
	const intervalMs = 20 * 60_000;
	if (location.origin !== sportsbookOrigin) {
		if (window.confirm("這個書籤要在運彩投注頁執行。現在前往？到了之後請再按一次書籤。")) {
			location.href = `${sportsbookOrigin}/daily-coupons`;
		}
		return;
	}
	const existing = page.__lotteryTslSync;
	if (existing?.isRunning?.()) return;
	existing?.stop?.();
	const mixedContent = location.protocol === "https:" && appOrigin.startsWith("http:");
	let target: Window | null = null;

	const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
	const isChallengePage = () => /請稍候|Just a moment/i.test(document.title);
	const waitForSportsbook = async (onProgress: (message: string) => void) => {
		const deadline = Date.now() + 30_000;
		while (isChallengePage()) {
			if (Date.now() >= deadline) {
				throw new Error("運彩頁的安全驗證還沒完成，請等賽事列表出現後再按一次書籤");
			}
			onProgress("運彩頁正在通過安全驗證，請稍候…");
			await delay(1_000);
		}
	};
	const getContent = async (type: string, id: string, language: string) => {
		let lastError: Error | undefined;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const response = await fetch("/services/content/get", {
				method: "POST",
				headers: { Accept: "application/json", "Content-Type": "application/json" },
				body: JSON.stringify({ contentId: { type, id }, clientContext: { language, ipAddress: "0.0.0.0" } })
			});
			const text = await response.text();
			const blocked = /Just a moment|請稍候|cf-browser-verification|正在執行安全驗證/i.test(text) || text.trimStart().startsWith("<");
			if (response.ok && !blocked) return JSON.parse(text) as { data?: unknown };
			lastError = new Error(
				blocked
					? "運彩頁的安全驗證還沒完成或已過期，請重新整理投注頁、等賽事列表出現後再按一次書籤"
					: `${type} 回應 HTTP ${response.status}`
			);
			if (!blocked && response.status !== 403 && response.status !== 429) throw lastError;
			await delay(1_000 * (attempt + 1));
		}
		throw lastError ?? new Error(`${type} 讀取失敗`);
	};
	const taipeiDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).replaceAll("-", "");
	const today = taipeiDay(new Date());
	const tomorrow = taipeiDay(new Date(Date.now() + 36e5 * 24));
	const navigation = async (id: string) => (await getContent("boNavigationList", `1/${id}`, "ZH")).data as NavigationNode | undefined;
	const SPORT_CODES = sportCodes.map((code) => code.toUpperCase());
	const hasEvents = (node: NavigationNode) => Number(node.numevents ?? 0) > 0;
	const isSupportedSport = (node: NavigationNode) => {
		const code = (node.focontentid ?? "").toUpperCase();
		const label = `${node.name ?? ""} ${node.description ?? ""} ${node.foname ?? ""}`;
		if (code === "BVB" || /沙灘排球|beach\s*volleyball/i.test(label)) return false;
		const named = /羽球|羽毛球|排球|badminton|volleyball/i.test(label);
		return SPORT_CODES.includes(code) || named;
	};
	const findSports = (node: NavigationNode): NavigationNode[] => {
		if (isSupportedSport(node) && node.idfwbonavigationtypes?.includes("SPORT")) return [node];
		return (node.bonavigationnodes ?? []).flatMap(findSports);
	};
	const listCouponGroups = async () => {
		const top = await navigation("top");
		const queue = top ? findSports(top).filter(hasEvents) : [];
		const groupIds = new Set<string>();
		while (queue.length > 0) {
			const node = queue.shift()!;
			const detail = await navigation(node.idfwbonavigation);
			for (const group of detail?.marketgroups ?? []) {
				if (group.idfwmarketgrouptype === "MATCHESCOUPON" || group.idfwmarketgrouptype === "EVENTCOUPON") {
					groupIds.add(group.idfwmarketgroup);
				}
			}
			queue.push(...(detail?.bonavigationnodes ?? []).filter(hasEvents));
			await delay(150);
		}
		return [...groupIds];
	};
	const keepEvent = (event: TslEvent) => {
		const raw = event.tsstart.trim();
		const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
			? raw
			: raw.includes("T")
				? `${raw}+08:00`
				: raw.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T") + "+08:00";
		const day = taipeiDay(new Date(normalized));
		return day === today || day === tomorrow;
	};
	const listEvents = async (groupIds: string[], language: string) => {
		const events: TslEvent[] = [];
		for (const groupId of groupIds) {
			const group = (await getContent("eventGroup", groupId, language)).data as { events?: TslEvent[] } | undefined;
			events.push(...(group?.events ?? []));
		}
		return events.filter(keepEvent);
	};
	const collect = async (onProgress: (message: string) => void) => {
		await waitForSportsbook(onProgress);
		onProgress("正在讀取運彩選單…");
		const groupIds = await listCouponGroups();
		onProgress(`找到 ${groupIds.length} 組賽事，正在列出今天與明天的場次…`);
		const chinese = await listEvents(groupIds, "ZH");
		onProgress(`列出 ${chinese.length} 場，接著抓英文隊名…`);
		const englishEn = await listEvents(groupIds, "EN");
		const englishUk = await listEvents(groupIds, "UK");
		const english = englishEn.length > 0 ? englishEn : englishUk;
		const events: unknown[] = [];
		for (const event of chinese) {
			if (events.length === 0 || events.length % 5 === 0) {
				onProgress(`正在抓各場賠率 ${events.length}/${chinese.length}…`);
			}
			const response = await getContent("event", event.idfoevent, "ZH");
			const detail = Array.isArray(response.data) ? response.data[0] : response.data;
			if (detail) events.push(detail);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
		onProgress(`已抓完 ${events.length} 場，正在送回 App…`);
		return {
			capturedAt: new Date().toISOString(),
			date: today,
			english: english.map((event) => ({
				idfoevent: event.idfoevent,
				participantname_away: event.participantname_away,
				participantname_home: event.participantname_home
			})),
			events,
			meta: { groups: groupIds.length, listed: chinese.length }
		};
	};

	let running = false;
	let notified = false;
	let ready = false;
	let direct = false;
	let timer = 0;
	const readyWaiters: Array<() => void> = [];
	const isAlive = () => direct || Boolean(target && !target.closed);
	const markReady = () => {
		ready = true;
		while (readyWaiters.length > 0) readyWaiters.shift()?.();
	};
	const waitForReady = (milliseconds: number) =>
		new Promise<void>((resolve) => {
			if (ready || direct || !target) {
				resolve();
				return;
			}
			const finish = () => {
				window.clearTimeout(timeout);
				resolve();
			};
			const timeout = window.setTimeout(() => {
				const index = readyWaiters.indexOf(finish);
				if (index >= 0) readyWaiters.splice(index, 1);
				resolve();
			}, milliseconds);
			readyWaiters.push(finish);
		});
	const postToApp = (message: { type: string; payload?: unknown; message?: string }) => {
		try {
			target?.postMessage(message, appOrigin);
		} catch {
			/* the app tab may not be ready yet */
		}
	};
	const notify = (message: string) => postToApp({ type: "tsl-status", message });
	const postDirectly = async (payload: unknown) => {
		if (mixedContent) {
			if (!notified) window.alert(`無法直接從運彩頁寫入 ${appOrigin}（混合內容）。請允許這個網站開啟彈出視窗，再按一次書籤。`);
			notified = true;
			return;
		}
		try {
			const response = await fetch(`${appOrigin}/api/tsl/import`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (!response.ok) throw new Error(`匯入回應 HTTP ${response.status}`);
			const summary = (await response.json()) as { fixtures: number };
			if (!notified) window.alert(`已匯入 ${summary.fixtures} 場賽事，回到計算頁重新整理即可看到。`);
		} catch (error) {
			if (!notified) window.alert(`同步失敗：${String(error)}。請確認 App 有在 ${appOrigin} 執行，或允許這個網站開啟彈出視窗。`);
		}
		notified = true;
	};
	const deliver = async (kind: "payload" | "error", data: unknown) => {
		if (!direct && target && !target.closed) {
			await waitForReady(15_000);
			if (ready && !target.closed) {
				postToApp(kind === "payload" ? { type: "tsl-payload", payload: data } : { type: "tsl-error", message: String(data) });
				return;
			}
			direct = true;
		}
		if (kind === "payload") {
			await postDirectly(data);
			return;
		}
		if (!notified) window.alert(`同步失敗：${String(data)}`);
		notified = true;
	};
	const run = async () => {
		if (running || !isAlive()) return;
		running = true;
		notify("開始從運彩頁讀取賽事…");
		try {
			await deliver("payload", await collect(notify));
		} catch (error) {
			notify("運彩頁讀取失敗");
			await deliver("error", error);
		} finally {
			running = false;
		}
	};
	const stop = () => {
		window.clearInterval(timer);
		page.__lotteryTslSync = undefined;
	};
	window.addEventListener("message", (event) => {
		if (event.origin !== appOrigin) return;
		if ((event.data as { type?: string } | null)?.type !== "tsl-ready") return;
		markReady();
	});
	target = window.open(`${appOrigin}/tsl-sync`, "lottery-tsl-sync");
	if (!target) {
		if (mixedContent) {
			window.alert(`瀏覽器擋下彈出視窗。HTTPS 運彩頁無法直接寫入 ${appOrigin}，請允許彈出視窗後再按一次書籤。`);
			notified = true;
			return;
		}
		direct = true;
	}
	void run();
	timer = window.setInterval(() => {
		if (!isAlive()) {
			stop();
			return;
		}
		void run();
	}, intervalMs);
	page.__lotteryTslSync = { isAlive, isRunning: () => running, stop, run };
};

// esbuild keepNames may wrap inner functions with __name(), which does not exist on the sportsbook page.
const NAME_HELPER_SHIM = "const __name=(fn)=>fn;";

export const buildTslBookmarklet = (appOrigin: string) => {
	const invocation = `(${tslCollector.toString()})(${JSON.stringify(appOrigin)},${JSON.stringify(TSL_ORIGIN)},${JSON.stringify(tslSportCodes())})`;
	return `javascript:${encodeURIComponent(`(()=>{${NAME_HELPER_SHIM}${invocation}})();void 0`)}`;
};
