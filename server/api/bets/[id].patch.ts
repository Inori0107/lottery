import { z } from 'zod'
import { BET_STATUSES } from '../../../shared/types'
import { getBet, setBetStatus, updateBetNote } from '../../models/ledgerStore'

const bodySchema = z.object({
  status: z.enum(BET_STATUSES).optional(),
  note: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: '狀態只能是未結算、贏、輸或作廢' })

  const ledger = useLedger()
  if (!getBet(ledger, id)) throw createError({ statusCode: 404, statusMessage: '找不到這筆投注' })
  if (parsed.data.note !== undefined) updateBetNote(ledger, id, parsed.data.note)
  if (parsed.data.status) setBetStatus(ledger, id, parsed.data.status)
  return getBet(ledger, id)
})
