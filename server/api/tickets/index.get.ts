import type { Sport, TicketsResponse } from '../../../shared/types'
import { getBankroll, listTickets } from '../../models/ledgerStore'
import { performanceSummary } from '../../../shared/performance'

export default defineEventHandler((event): TicketsResponse => {
  const query = getQuery(event)
  const sport = query.sport === 'badminton' || query.sport === 'volleyball' || query.sport === 'tennis'
    ? query.sport as Sport
    : null
  const ledgerKind = query.ledger === 'real' ? 'real' : 'sim'
  const strategy = query.strategy === 'research' || query.strategy === 'conservative' ? query.strategy : null
  const ledger = useLedger()
  return {
    tickets: listTickets(ledger, sport, ledgerKind, false, strategy),
    bankroll: getBankroll(ledger, ledgerKind),
    stats: performanceSummary(listTickets(ledger, sport, ledgerKind, true, strategy)),
  }
})
