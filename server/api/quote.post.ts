import { z } from 'zod'
import { isHalfLine } from '../../shared/decision'
import { quoteBadminton } from '../models/badmintonQuote'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)

const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

const bodySchema = z.object({
  discipline: z.enum(['MS', 'WS']),
  awayPlayerId: z.string().min(1),
  homePlayerId: z.string().min(1),
  matchOdds: oddsSchema.optional(),
  game1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.object({
    '2:0': decimalOdds,
    '2:1': decimalOdds,
    '1:2': decimalOdds,
    '0:2': decimalOdds,
  }).optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩名選手，確認賠率大於 1、盤口線是 .5' })
  }
  try {
    return quoteBadminton(useDb().sqlite, parsed.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : '計算失敗'
    throw createError({ statusCode: message.includes('回測') ? 503 : 400, statusMessage: message })
  }
})
