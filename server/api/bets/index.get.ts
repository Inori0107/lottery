import type { BetsResponse, Sport } from '../../../shared/types'
import { listBetsForSport } from '../../models/ledgerStore'
import { summarizeBetGroups } from '../../models/settle'

export default defineEventHandler((event): BetsResponse => {
  const query = getQuery(event)
  const sport = query.sport === 'volleyball' || query.sport === 'badminton' || query.sport === 'tennis'
    ? query.sport as Sport
    : null
  const bets = listBetsForSport(useLedger(), sport)
  return { bets, summary: summarizeBetGroups(bets) }
})
