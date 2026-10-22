import { importTslPayload } from '../../models/liveSync'
import { tslPayloadSchema } from '../../models/tsl'
import { allowSportsbookOrigin } from '../../utils/sportsbookCors'

export default defineEventHandler(async (event) => {
  allowSportsbookOrigin(event)
  const parsed = tslPayloadSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '運彩資料格式不符，請更新書籤小工具後再試' })
  }
  return importTslPayload(useLedger(), useOptionalDb(), parsed.data)
})
