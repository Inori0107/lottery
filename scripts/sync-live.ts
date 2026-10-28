import { existsSync } from 'node:fs'
import { openLedger } from '../server/db/ledger'
import { openDatabase } from '../server/db/open'
import { syncLiveResults } from '../server/models/liveSync'
import { dbFile, ledgerFile, statshubDir, tennisStatshubDir, volleyballStatshubDir } from './paths'

const syncLive = async () => {
  const ledger = openLedger(ledgerFile)
  const main = existsSync(dbFile) ? openDatabase(dbFile).sqlite : null
  try {
    const result = await syncLiveResults(ledger, main, statshubDir, volleyballStatshubDir, tennisStatshubDir)
    if (result.dates.length === 0) {
      console.log(`沒有待更新的運彩場次，結算 ${result.settled} 筆投注`)
      return
    }
    console.log(`賽果更新：${result.dates.join('、')}，更新 ${result.updated} 場，結算 ${result.settled} 筆投注`)
    for (const error of result.errors) console.error(`StatsHub 讀取失敗 ${error}`)
  } finally {
    ledger.close()
    main?.close()
  }
}

await syncLive()
