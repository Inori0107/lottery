import { listParlays } from '../../models/parlayStore'

export default defineEventHandler(() => listParlays(useLedger()))
