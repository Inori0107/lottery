import { z } from 'zod'
import { buildAnalysisPackText } from '../models/analysisPack'
import { getFixtureSummary } from '../models/ledgerStore'

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
    const text = buildAnalysisPackText(sqlite, fixture, quote)
    return { text }
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : '無法產生分析包',
    })
  }
})
