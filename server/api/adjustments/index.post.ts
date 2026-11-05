import { z } from 'zod'
import { ADJUSTMENT_CATEGORIES } from '../../../shared/adjustments'
import { BET_MARKETS } from '../../../shared/types'
import { insertAdjustment } from '../../models/adjustments'

const bodySchema = z.object({
  fixtureId: z.number().int(),
  market: z.enum(BET_MARKETS),
  outcomeKey: z.string().min(1),
  deltaPct: z.number(),
  reasonCategory: z.enum(ADJUSTMENT_CATEGORIES),
  note: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請填調整幅度與原因類別' })
  }
  try {
    return insertAdjustment(useLedger(), parsed.data)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : '無法記錄調整',
    })
  }
})
