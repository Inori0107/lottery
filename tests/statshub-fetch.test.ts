import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	fetchStatshubHtmlWithRetry,
	classifyError,
	loadFailedDates,
	saveFailedDates,
	recordFailedDate,
	clearFailedDate,
	getFailedDatesForSport,
	type FailedDatesStore,
	STATSHUB_MAX_RETRIES,
} from "../server/models/statshubLoader";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const classifyErrorFn = (status: number | null, message: string) => {
	if (status === null) {
		return { type: 'network' as const, status: null, message, retryable: true }
	}
	if (status >= 500) {
		return { type: 'server' as const, status, message, retryable: true }
	}
	if (status === 404) {
		return { type: 'nodata' as const, status, message, retryable: false }
	}
	return { type: 'client' as const, status, message, retryable: false }
};

describe("錯誤分類", () => {
	it("5xx 錯誤標為可重試的 server 錯誤", () => {
		const error = classifyErrorFn(500, "Internal Server Error");
		expect(error.type).toBe("server");
		expect(error.retryable).toBe(true);
	});

	it("503 錯誤也是可重試的 server 錯誤", () => {
		const error = classifyErrorFn(503, "Service Unavailable");
		expect(error.type).toBe("server");
		expect(error.retryable).toBe(true);
	});

	it("404 錯誤標為不可重試的 nodata 錯誤", () => {
		const error = classifyErrorFn(404, "Not Found");
		expect(error.type).toBe("nodata");
		expect(error.retryable).toBe(false);
	});

	it("403 錯誤標為不可重試的 client 錯誤", () => {
		const error = classifyErrorFn(403, "Forbidden");
		expect(error.type).toBe("client");
		expect(error.retryable).toBe(false);
	});

	it("網路錯誤（無狀態碼）標為可重試", () => {
		const error = classifyErrorFn(null, "ECONNREFUSED");
		expect(error.type).toBe("network");
		expect(error.retryable).toBe(true);
	});
});

describe("失敗日期持久化", () => {
	const testDir = join(process.cwd(), ".test-data");

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("讀取不存在的檔案回傳空物件", () => {
		const store = loadFailedDates(testDir);
		expect(store).toEqual({});
	});

	it("記錄、儲存、重新載入失敗日期", () => {
		const store: FailedDatesStore = {};
		recordFailedDate(store, "football", "2026-07-25", "HTTP 500");
		recordFailedDate(store, "football", "2026-07-26", "HTTP 503");
		recordFailedDate(store, "badminton", "2026-08-01", "網路錯誤");

		saveFailedDates(testDir, store);

		const reloaded = loadFailedDates(testDir);
		expect(getFailedDatesForSport(reloaded, "football")).toEqual(["2026-07-25", "2026-07-26"]);
		expect(getFailedDatesForSport(reloaded, "badminton")).toEqual(["2026-08-01"]);
	});

	it("清除成功的日期後不再出現", () => {
		const store: FailedDatesStore = {};
		recordFailedDate(store, "football", "2026-07-25", "HTTP 500");
		recordFailedDate(store, "football", "2026-07-26", "HTTP 503");

		clearFailedDate(store, "football", "2026-07-25");

		expect(getFailedDatesForSport(store, "football")).toEqual(["2026-07-26"]);
	});

	it("清除最後一個日期後運動項目也被清除", () => {
		const store: FailedDatesStore = {};
		recordFailedDate(store, "football", "2026-07-25", "HTTP 500");

		clearFailedDate(store, "football", "2026-07-25");

		expect(store.football).toBeUndefined();
	});

	it("重複記錄同一日期會增加嘗試次數", () => {
		const store: FailedDatesStore = {};
		recordFailedDate(store, "football", "2026-07-25", "HTTP 500");
		recordFailedDate(store, "football", "2026-07-25", "HTTP 503");

		expect(store.football!["2026-07-25"]!.attempts).toBe(2);
		expect(store.football!["2026-07-25"]!.error).toBe("HTTP 503");
	});
});

describe("帶重試的抓取（模擬）", () => {
	const originalFetch = globalThis.fetch;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		globalThis.fetch = fetchMock;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("成功時立即回傳", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			text: async () => "<html>success</html>",
		});

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 3, 10);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toBe("<html>success</html>");
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("5xx 錯誤會重試直到成功", async () => {
		fetchMock
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockResolvedValueOnce({ ok: false, status: 503 })
			.mockResolvedValueOnce({
				ok: true,
				text: async () => "<html>recovered</html>",
			});

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 3, 10);

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("超過最大重試次數後回傳失敗", async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 500 });

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 2, 10);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.type).toBe("server");
			expect(result.error.status).toBe(500);
		}
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("404 錯誤不重試", async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 3, 10);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.type).toBe("nodata");
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("網路錯誤會重試", async () => {
		fetchMock
			.mockRejectedValueOnce(new Error("ECONNREFUSED"))
			.mockRejectedValueOnce(new Error("ETIMEDOUT"))
			.mockResolvedValueOnce({
				ok: true,
				text: async () => "<html>recovered</html>",
			});

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 3, 10);

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("混合錯誤類型也會正確處理", async () => {
		fetchMock
			.mockRejectedValueOnce(new Error("ECONNREFUSED"))
			.mockResolvedValueOnce({ ok: false, status: 503 })
			.mockResolvedValueOnce({ ok: false, status: 404 });

		const result = await fetchStatshubHtmlWithRetry("2026-07-20", "https://example.com", 3, 10);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.type).toBe("nodata");
		}
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
