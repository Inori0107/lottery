import type { BetsResponse } from '../../../shared/types'
import { listBets } from '../../models/ledgerStore'
import { summarizeBetGroups } from '../../models/settle'

export default defineEventHandler((): BetsResponse => {
  const bets = listBets(useLedger())
  return { bets, summary: summarizeBetGroups(bets) }
})
