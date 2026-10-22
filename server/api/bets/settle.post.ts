import { join } from 'node:path'
import { syncLiveResults } from '../../models/liveSync'

export default defineEventHandler(async () => {
  const { projectRoot } = useRuntimeConfig()
  return syncLiveResults(useLedger(), useOptionalDb(), join(projectRoot, 'data/raw/statshub'))
})
