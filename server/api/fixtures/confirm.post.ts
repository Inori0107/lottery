import { z } from 'zod'
import { confirmFixtureCompetitor, readTodayFixtures } from '../../models/ledgerStore'

const bodySchema = z.object({
  sportradarId: z.number().int().positive(),
  side: z.enum(['away', 'home']),
  playerId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請指定場次、客/主、以及資料庫選手或隊伍' })
  }
  const updated = confirmFixtureCompetitor(useLedger(), useOptionalDb(), parsed.data)
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: '找不到這場賽事或選手不在資料庫' })
  }
  return readTodayFixtures(useLedger(), useOptionalDb(), () => true)
})
