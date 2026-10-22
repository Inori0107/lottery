import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const rawDir = join(root, 'data/raw')
export const reportDir = join(root, 'data/reports')
export const statshubDir = join(rawDir, 'statshub')
export const liveDbFile = join(root, '.data/badminton.sqlite')
export const nextDbFile = join(root, '.data/badminton.next.sqlite')
export const dbFile = process.env.BADMINTON_DB_FILE ?? liveDbFile
export const ledgerFile = process.env.BADMINTON_LEDGER_FILE ?? join(root, '.data/ledger.sqlite')
