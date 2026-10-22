import { deleteBet } from '../../models/ledgerStore'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!deleteBet(useLedger(), id)) throw createError({ statusCode: 404, statusMessage: '找不到這筆投注' })
  return { ok: true }
})
