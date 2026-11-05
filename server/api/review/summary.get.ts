import { addCalendarDays, taipeiDate } from '../../../shared/tslTime'
import { buildReviewReport, formatReviewSummary } from '../../models/review'

export default defineEventHandler((event) => {
  const period = getQuery(event).period === 'weekly' ? 'weekly' : 'daily'
  const today = taipeiDate(new Date())
  const from = period === 'weekly' ? addCalendarDays(today, -6) : today
  const report = buildReviewReport(useLedger(), { from, to: today })
  const label = period === 'weekly' ? `週 ${from}～${today}` : `日 ${today}`
  return { period, from, to: today, text: formatReviewSummary(report, label), n: report.n }
})
