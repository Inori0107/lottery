import { join } from 'node:path'
import { syncLiveResults } from '../../models/liveSync'

export default defineEventHandler(async () => {
  const { projectRoot } = useRuntimeConfig()
  const root = join(projectRoot, 'data/raw/statshub')
  return syncLiveResults(
    useLedger(),
    useOptionalDb(),
    root,
    join(root, 'volleyball'),
    join(root, 'tennis'),
  )
})
