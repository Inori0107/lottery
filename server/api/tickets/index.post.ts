import { z } from 'zod'
import { MAX_PARLAY_LEGS } from '../../../shared/parlay'
import { BET_MARKETS } from '../../../shared/types'
import { insertTicket } from '../../models/ledgerStore'

const legSchema = z.object({
  fixtureId: z.number().int().nullable(),
  sport: z.enum(['badminton', 'volleyball', 'tennis']),
  discipline: z.enum(['MS', 'WS', 'M', 'W', 'ATP', 'WTA']),
  awayName: z.string().min(1),
  homeName: z.string().min(1),
  startsAt: z.string().nullable(),
  market: z.enum(BET_MARKETS),
  outcomeKey: z.string().min(1),
  outcomeLabel: z.string().min(1),
  line: z.number().nullable(),
  odds: z.number().gt(1),
  probability: z.number().min(0).max(1).nullable(),
  ev: z.number().nullable(),
  action: z.enum(['pass', 'watch', 'candidate']).nullable(),
  modelVersion: z.string().nullable(),
})

const bodySchema = z.object({
  ledgerKind: z.enum(['sim', 'real']).default('sim'),
  stake: z.number().positive(),
  note: z.string().max(500).optional(),
  legs: z.array(legSchema).min(1).max(MAX_PARLAY_LEGS),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請確認每腿賠率大於 1、金額大於 0' })
  }
  try {
    return insertTicket(useLedger(), parsed.data)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : '無法送出過關單' })
  }
})
