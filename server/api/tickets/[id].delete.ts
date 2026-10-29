import { deleteTicket } from '../../models/ledgerStore'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!deleteTicket(useLedger(), id)) throw createError({ statusCode: 404, statusMessage: '找不到這張投注單' })
  return { ok: true }
})
