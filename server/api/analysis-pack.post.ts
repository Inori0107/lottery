import { z } from 'zod'
import { buildAnalysisPackText, quoteFixture } from '../models/analysisPack'
import { latestAdjustmentsLookup } from '../models/adjustments'
import { getFixtureSummary } from '../models/ledgerStore'
import { recordPredictionSnapshot } from '../models/predictions'
import { quoteOutcomeRows } from '../models/quoteOutcomes'

const bodySchema = z.object({
  fixtureId: z.number().int().optional(),
  quote: z.unknown().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請提供場次或已計算的報價' })
  }
  const ledger = useLedger()
  const sqlite = useOptionalDb()
  const fixture = parsed.data.fixtureId
    ? getFixtureSummary(ledger, sqlite, parsed.data.fixtureId)
    : null
  if (parsed.data.fixtureId && !fixture) {
    throw createError({ statusCode: 404, statusMessage: '找不到這場對局' })
  }
  const quote = parsed.data.quote && typeof parsed.data.quote === 'object'
    ? parsed.data.quote as Parameters<typeof buildAnalysisPackText>[2]
    : null
  try {
    const resolvedQuote = quote ?? (fixture ? quoteFixture(sqlite, fixture) : null)
    const adjustments = fixture && resolvedQuote
      ? latestAdjustmentsLookup(ledger, fixture.sportradarId, quoteOutcomeRows(resolvedQuote).map(row => ({
        market: row.market,
        outcomeKey: row.outcomeKey,
        raw: row.modelRaw,
      })))
      : []
    const text = buildAnalysisPackText(sqlite, fixture, resolvedQuote, adjustments)
    if (fixture && resolvedQuote) recordPredictionSnapshot(ledger, fixture, resolvedQuote)
    return { text }
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : '無法產生分析包',
    })
  }
})
