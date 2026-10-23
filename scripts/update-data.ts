import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { copyIsolatedSportTables } from '../server/db/copySportTables'
import { liveDbFile, nextDbFile, root, statshubDir } from './paths'

const lockFile = join(root, '.data/update.lock')
const stateFile = join(root, '.data/update-state.json')
const tsxBin = join(root, 'node_modules/.bin/tsx')
const STALE_LOCK_MS = 60 * 60 * 1000
const FETCH_INTERVAL_MS = 60 * 60 * 1000
const force = process.argv.includes('--force')

type UpdateState = {
  fetchedAt: number
  sources: string
}

const readState = (): UpdateState => {
  if (!existsSync(stateFile)) return { fetchedAt: 0, sources: '' }
  return JSON.parse(readFileSync(stateFile, 'utf8')) as UpdateState
}

const writeState = (state: UpdateState) => writeFileSync(stateFile, JSON.stringify(state, null, 2))

const runScript = (script: string, env: Record<string, string> = {}) =>
  execFileSync(tsxBin, [join(root, 'scripts', script)], { stdio: 'inherit', env: { ...process.env, ...env } })

const acquireLock = () => {
  mkdirSync(dirname(lockFile), { recursive: true })
  const lock = statSync(lockFile, { throwIfNoEntry: false })
  if (lock && Date.now() - lock.mtimeMs < STALE_LOCK_MS) return false
  rmSync(lockFile, { force: true })
  closeSync(openSync(lockFile, 'wx'))
  return true
}

const sourceSignature = () => {
  mkdirSync(statshubDir, { recursive: true })
  return readdirSync(statshubDir).filter(file => file.endsWith('.html')).sort().join(',')
}

const swapDatabase = () => {
  for (const suffix of ['-wal', '-shm']) rmSync(`${liveDbFile}${suffix}`, { force: true })
  renameSync(nextDbFile, liveDbFile)
}

const updateData = () => {
  if (!acquireLock()) {
    console.log('另一個資料更新正在執行，略過')
    return
  }
  try {
    const state = readState()
    if (force || Date.now() - state.fetchedAt >= FETCH_INTERVAL_MS) {
      try {
        runScript('fetch-statshub.ts')
        state.fetchedAt = Date.now()
        writeState(state)
      } catch {
        console.error('Sportradar 抓取失敗，改用本機已有的頁面')
      }
    }

    const sources = sourceSignature()
    if (!force && existsSync(liveDbFile) && state.sources === sources) {
      console.log('沒有新賽果，資料庫不重建')
      return
    }

    runScript('import-matches.ts', { BADMINTON_DB_FILE: nextDbFile })
    runScript('backtest.ts', { BADMINTON_DB_FILE: nextDbFile })
    if (existsSync(liveDbFile)) copyIsolatedSportTables(liveDbFile, nextDbFile)
    swapDatabase()
    writeState({ ...state, sources })
    console.log('資料庫已更新')
  } finally {
    rmSync(lockFile, { force: true })
  }
}

updateData()
