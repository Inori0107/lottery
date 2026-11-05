import { badmintonQuoteSchema, buildBadmintonQuote } from '../models/badmintonQuote'

export default defineEventHandler(async event => {
  const parsed = badmintonQuoteSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: '請選擇兩名選手，確認賠率大於 1、盤口線為 .5' })
  try {
    return buildBadmintonQuote(useDb().sqlite, useLedger(), parsed.data)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : '無法計算' })
  }
})
