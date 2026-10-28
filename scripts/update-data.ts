import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { liveDbFile, nextDbFile, root, statshubDir, tennisStatshubDir, volleyballStatshubDir } from "./paths";

const lockFile = join(root, ".data/update.lock");
const stateFile = join(root, ".data/update-state.json");
const tsxBin = join(root, "node_modules/.bin/tsx");
const STALE_LOCK_MS = 60 * 60 * 1000;
const FETCH_INTERVAL_MS = 60 * 60 * 1000;
const force = process.argv.includes("--force");

type UpdateState = {
	fetchedAt: number;
	sources: string;
};

const readState = (): UpdateState => {
	if (!existsSync(stateFile)) return { fetchedAt: 0, sources: "" };
	return JSON.parse(readFileSync(stateFile, "utf8")) as UpdateState;
};

const writeState = (state: UpdateState) => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const runScript = (script: string, env: Record<string, string> = {}) =>
	execFileSync(tsxBin, [join(root, "scripts", script)], { stdio: "inherit", env: { ...process.env, ...env } });

const processIsAlive = (pid: number) => {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const acquireLock = () => {
	mkdirSync(dirname(lockFile), { recursive: true });
	const lock = statSync(lockFile, { throwIfNoEntry: false });
	if (lock) {
		const pid = Number(readFileSync(lockFile, "utf8").trim());
		const fresh = Date.now() - lock.mtimeMs < STALE_LOCK_MS;
		if (fresh && processIsAlive(pid)) return false;
		rmSync(lockFile, { force: true });
	}
	writeFileSync(lockFile, `${process.pid}\n`);
	return true;
};

const sourceFiles = (dir: string) => {
	mkdirSync(dir, { recursive: true });
	return readdirSync(dir)
		.filter((file) => file.endsWith(".html"))
		.sort();
};

const sourceSignature = () =>
	[
		...sourceFiles(statshubDir).map((file) => `badminton:${file}`),
		...sourceFiles(volleyballStatshubDir).map((file) => `volleyball:${file}`),
		...sourceFiles(tennisStatshubDir).map((file) => `tennis:${file}`)
	].join(",");

const swapDatabase = () => {
	for (const suffix of ["-wal", "-shm"]) rmSync(`${liveDbFile}${suffix}`, { force: true });
	renameSync(nextDbFile, liveDbFile);
};

const updateData = () => {
	if (!acquireLock()) {
		console.log("另一個資料更新正在執行，略過");
		return;
	}
	try {
		const state = readState();
		if (force || Date.now() - state.fetchedAt >= FETCH_INTERVAL_MS) {
			try {
				runScript("fetch-statshub.ts");
				state.fetchedAt = Date.now();
				writeState(state);
			} catch {
				console.error("Sportradar 抓取失敗，改用本機已有的頁面");
			}
		}

		const sources = sourceSignature();
		if (!force && existsSync(liveDbFile) && state.sources === sources) {
			console.log("沒有新賽果，資料庫不重建");
			return;
		}

		runScript("import-matches.ts", { BADMINTON_DB_FILE: nextDbFile });
		runScript("backtest.ts", { BADMINTON_DB_FILE: nextDbFile });
		try {
			runScript("import-volleyball.ts", { BADMINTON_DB_FILE: nextDbFile });
		} catch {
			console.error("排球匯入失敗，先寫入羽球資料；請確認已抓到 StatsHub 排球頁");
		}
		try {
			runScript("import-tennis.ts", { BADMINTON_DB_FILE: nextDbFile });
		} catch {
			console.error("網球匯入失敗，先寫入已有資料；請確認已抓到 StatsHub 網球頁");
		}
		swapDatabase();
		writeState({ ...state, sources });
		console.log("資料庫已更新");
	} finally {
		rmSync(lockFile, { force: true });
	}
};

updateData();
