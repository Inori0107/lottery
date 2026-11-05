import { z } from 'zod'
import { isHalfLine } from '../../../shared/decision'
import { quoteVolleyball } from '../../models/volleyballQuote'

const decimalOdds = z.number().gt(1)
const halfLine = z.number().refine(isHalfLine)

const oddsSchema = z.object({
  away: decimalOdds,
  home: decimalOdds,
})

const bodySchema = z.object({
  discipline: z.enum(['M', 'W']),
  awayTeamId: z.string().min(1),
  homeTeamId: z.string().min(1),
  isHome: z.boolean().default(false),
  matchOdds: oddsSchema.optional(),
  set1Odds: oddsSchema.optional(),
  totalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  handicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  correctScoreOdds: z.object({
    '3:0': decimalOdds,
    '3:1': decimalOdds,
    '3:2': decimalOdds,
    '2:3': decimalOdds,
    '1:3': decimalOdds,
    '0:3': decimalOdds,
  }).optional(),
  setHandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
  set1TotalOdds: z.object({ line: halfLine.refine(line => line > 0), over: decimalOdds, under: decimalOdds }).optional(),
  set1HandicapOdds: z.object({ awayLine: halfLine, away: decimalOdds, home: decimalOdds }).optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '請選擇項目、兩支球隊，確認賠率大於 1、盤口線是 .5' })
  }
  try {
    return quoteVolleyball(useDb().sqlite, parsed.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : '計算失敗'
    throw createError({ statusCode: message.includes('回測') || message.includes('尚未建立') ? 503 : 400, statusMessage: message })
  }
})
