import type { FixturesResponse } from '../../../shared/types'
import { emptyFixturesResponse, readTodayFixtures } from '../../models/ledgerStore'

export default defineEventHandler((): FixturesResponse => {
  try {
    let mainSqlite = null
    try {
      mainSqlite = useOptionalDb()
    } catch {
      mainSqlite = null
    }
    return readTodayFixtures(useLedger(), mainSqlite, fixture =>
      fixture.discipline === 'ATP' || fixture.discipline === 'WTA',
    )
  } catch {
    return emptyFixturesResponse('今日網球對局讀取失敗，請稍後再試或重新匯入運彩賠率。')
  }
})
