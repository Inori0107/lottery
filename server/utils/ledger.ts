import { openLedger, type LedgerDatabase } from '../db/ledger'

const globalForLedger = globalThis as typeof globalThis & {
  __badmintonLedger?: { file: string, sqlite: LedgerDatabase }
}

export const useLedger = () => {
  const { ledgerFile } = useRuntimeConfig()
  const cached = globalForLedger.__badmintonLedger
  if (cached?.file === ledgerFile) return cached.sqlite

  cached?.sqlite.close()
  const sqlite = openLedger(ledgerFile)
  globalForLedger.__badmintonLedger = { file: ledgerFile, sqlite }
  return sqlite
}
