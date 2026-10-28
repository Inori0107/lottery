import type { Sport, TicketKind, TicketsResponse } from '../../../shared/types'
import { getBankroll, listTickets } from '../../models/ledgerStore'

export default defineEventHandler((event): TicketsResponse => {
  const query = getQuery(event)
  const sport = query.sport === 'badminton' || query.sport === 'volleyball' || query.sport === 'tennis'
    ? query.sport as Sport
    : null
  const kind = query.kind === 'single' || query.kind === 'parlay' ? query.kind as TicketKind : null
  const ledgerKind = query.ledger === 'real' ? 'real' : 'sim'
  const ledger = useLedger()
  return {
    tickets: listTickets(ledger, sport, kind),
    bankroll: getBankroll(ledger, ledgerKind),
  }
})
