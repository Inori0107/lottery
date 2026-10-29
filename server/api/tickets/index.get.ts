import type { Sport, TicketsResponse } from '../../../shared/types'
import { getBankroll, listTickets } from '../../models/ledgerStore'

export default defineEventHandler((event): TicketsResponse => {
  const query = getQuery(event)
  const sport = query.sport === 'badminton' || query.sport === 'volleyball' || query.sport === 'tennis'
    ? query.sport as Sport
    : null
  const ledgerKind = query.ledger === 'real' ? 'real' : 'sim'
  const ledger = useLedger()
  return {
    tickets: listTickets(ledger, sport),
    bankroll: getBankroll(ledger, ledgerKind),
  }
})
