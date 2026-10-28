import { z } from 'zod'
import { BET_MARKETS } from '../../../shared/types'
import { getSportForDiscipline } from '../../../shared/sports'
import { insertBet } from '../../models/ledgerStore'

const bodySchema = z.object({
  fixtureId: z.number().int().nullable(),
  sourceMarketId: z.string().nullable().optional(),
  oddsCapturedAt: z.string().datetime().nullable().optional(),
  sport: z.enum(['badminton', 'volleyball', 'tennis']).optional(),
  discipline: z.enum(['MS', 'WS', 'M', 'W', 'ATP', 'WTA']),
  awayName: z.string().min(1),
  homeName: z.string().min(1),
  startsAt: z.string().nullable(),
  market: z.enum(BET_MARKETS),
  outcomeKey: z.string().min(1),
  outcomeLabel: z.string().min(1),
  line: z.number().nullable(),
  odds: z.number().gt(1),
  stake: z.number().positive(),
  modelVersion: z.string().nullable(),
  probability: z.number().min(0).max(1).nullable(),
  ev: z.number().nullable(),
  action: z.enum(['pass', 'watch', 'candidate']).nullable(),
  note: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請確認賠率大於 1、金額大於 0' })
  }
  const ledger = useLedger()
  const { fixtureId } = parsed.data
  const fixtureExists = fixtureId !== null && Boolean(ledger.prepare('SELECT 1 FROM fixtures WHERE sportradar_id = ?').get(fixtureId))
  return insertBet(ledger, {
    ...parsed.data,
    sport: parsed.data.sport ?? getSportForDiscipline(parsed.data.discipline) ?? 'badminton',
    fixtureId: fixtureExists ? fixtureId : null,
  })
})
