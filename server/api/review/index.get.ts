import type { BetMarket, Sport } from '../../../shared/types'
import { BET_MARKETS } from '../../../shared/types'
import { buildReviewReport, type ReviewFilters } from '../../models/review'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const sport = query.sport === 'badminton' || query.sport === 'volleyball' ? query.sport as Sport : ''
  const market = BET_MARKETS.includes(query.market as BetMarket) ? query.market as BetMarket : ''
  const filters: ReviewFilters = {
    sport,
    market,
    competition: typeof query.competition === 'string' ? query.competition : '',
    action: typeof query.action === 'string' ? query.action : '',
    dataSufficient: query.dataSufficient === 'yes' || query.dataSufficient === 'no' ? query.dataSufficient : 'all',
    from: typeof query.from === 'string' ? query.from : '',
    to: typeof query.to === 'string' ? query.to : '',
  }
  return buildReviewReport(useLedger(), filters)
})
