import type { FixturesResponse } from '../../shared/types'
import { lastTslImport, listFixtures, taipeiDate } from '../models/ledgerStore'

export default defineEventHandler((): FixturesResponse => {
  const ledger = useLedger()
  const date = taipeiDate(new Date())
  return {
    date,
    lastImportAt: lastTslImport(ledger),
    fixtures: listFixtures(ledger, useOptionalDb(), date),
  }
})
