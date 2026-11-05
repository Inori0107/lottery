import { z } from 'zod'
import { BET_MARKETS } from '../../../shared/types'
import { insertParlay } from '../../models/parlayStore'

const legSchema = z.object({
  id: z.string(),
  fixtureId: z.number().int().nullable(),
  sport: z.enum(['badminton', 'volleyball']),
  discipline: z.enum(['MS', 'WS', 'M', 'W']),
  tournament: z.string(),
  round: z.string(),
  awayName: z.string().min(1),
  homeName: z.string().min(1),
  market: z.enum(BET_MARKETS),
  outcomeKey: z.string().min(1),
  outcomeLabel: z.string().min(1),
  line: z.number().nullable(),
  odds: z.number().gt(1),
  probability: z.number().min(0).max(1).nullable(),
  probabilitySource: z.enum(['model', 'market']),
  dataSufficient: z.boolean(),
  startsAt: z.string().nullable(),
})

const bodySchema = z.object({
  legs: z.array(legSchema).min(2),
  stake: z.number().positive(),
  note: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '過關至少兩腳，金額大於 0' })
  }
  try {
    return insertParlay(useLedger(), parsed.data)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : '無法記錄過關',
    })
  }
})
