import { z } from 'zod'
import { DEFAULT_PARLAY_CONFIG, evaluateParlay, type ParlayConfig, type ParlayLeg } from '../../../shared/parlay'
import { BET_MARKETS } from '../../../shared/types'

const configSchema = z.object({
  maxFragileLegs: z.number().int().min(0),
  maxSameCompetitionRoundLegs: z.number().int().min(0),
  shortOddsThreshold: z.number().gt(1),
  suggestSplitAtLegs: z.number().int().min(2),
  splitSize: z.number().int().min(2),
  badmintonFragileHandicapAbs: z.number().positive(),
  volleyballFragileHandicapAbs: z.number().positive(),
  fragileSetHandicapAbs: z.number().positive(),
}).partial()

const bodySchema = z.object({
  legs: z.array(z.object({
    id: z.string(),
    fixtureId: z.number().int().nullable(),
    sport: z.enum(['badminton', 'volleyball']),
    discipline: z.enum(['MS', 'WS', 'M', 'W']),
    tournament: z.string(),
    round: z.string(),
    awayName: z.string(),
    homeName: z.string(),
    market: z.enum(BET_MARKETS),
    outcomeKey: z.string(),
    outcomeLabel: z.string(),
    line: z.number().nullable(),
    odds: z.number(),
    probability: z.number().nullable(),
    probabilitySource: z.enum(['model', 'market']),
    dataSufficient: z.boolean(),
    startsAt: z.string().nullable(),
  })),
  config: configSchema.optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '無法檢查過關' })
  }
  const config: ParlayConfig = { ...DEFAULT_PARLAY_CONFIG, ...parsed.data.config }
  return evaluateParlay(parsed.data.legs as ParlayLeg[], config)
})
