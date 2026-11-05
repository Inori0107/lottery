import { z } from 'zod'
import { getFixtureSummary } from '../../models/ledgerStore'
import { recordPredictionSnapshot } from '../../models/predictions'
import type { QuoteResponse } from '../../../shared/types'

const bodySchema = z.object({
  fixtureId: z.number().int(),
  quote: z.unknown(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請提供場次與報價' })
  }
  const ledger = useLedger()
  const fixture = getFixtureSummary(ledger, useOptionalDb(), parsed.data.fixtureId)
  if (!fixture) throw createError({ statusCode: 404, statusMessage: '找不到這場對局' })
  const count = recordPredictionSnapshot(ledger, fixture, parsed.data.quote as QuoteResponse)
  return { snapshots: count }
})
