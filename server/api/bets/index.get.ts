import type { BetsResponse, Sport } from '../../../shared/types'
import { listBets } from '../../models/ledgerStore'
import { summarizeBetGroups } from '../../models/settle'

export default defineEventHandler((event): BetsResponse => {
  const query = getQuery(event)
  const sport = query.sport === 'volleyball' || query.sport === 'tennis' || query.sport === 'badminton'
    ? query.sport as Sport
    : null
  const bets = listBets(useLedger()).filter(bet => sport === null || bet.sport === sport)
  return { bets, summary: summarizeBetGroups(bets) }
})
