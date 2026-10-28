import type { BankrollRecord, LedgerKind } from '../../shared/types'
import { getBankroll } from '../models/ledgerStore'

export default defineEventHandler((event): BankrollRecord => {
  const ledgerKind: LedgerKind = getQuery(event).ledger === 'real' ? 'real' : 'sim'
  return getBankroll(useLedger(), ledgerKind)
})
