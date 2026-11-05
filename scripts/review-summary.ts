import { addCalendarDays, taipeiDate } from '../shared/tslTime'
import { openLedger } from '../server/db/ledger'
import { buildReviewReport, formatReviewSummary } from '../server/models/review'

const period = process.argv.includes('--weekly') ? 'weekly' : 'daily'
const today = taipeiDate(new Date())
const from = period === 'weekly' ? addCalendarDays(today, -6) : today
const ledgerFile = process.env.LEDGER_FILE ?? 'data/ledger.sqlite'
const ledger = openLedger(ledgerFile)
const report = buildReviewReport(ledger, { from, to: today })
const label = period === 'weekly' ? `週 ${from}～${today}` : `日 ${today}`
process.stdout.write(formatReviewSummary(report, label))
ledger.close()
