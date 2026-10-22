import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLIC_PAGE_ROUTES, SPORT_NAV_LINKS, pageFilesForRoute } from '../shared/nav'
import { buildTslBookmarklet } from '../app/utils/tslBookmarklet'

describe('運動導覽路由', () => {
  it('羽球、排球、網球導覽列都有計算、投注、同步、賽事', () => {
    for (const sport of ['badminton', 'volleyball', 'tennis'] as const) {
      const labels = SPORT_NAV_LINKS[sport].map(link => link.label)
      expect(labels).toEqual(['計算', '投注紀錄', '賠率同步', '已匯入賽事'])
    }
  })

  it('公開頁面都有對應的 Vue 檔', () => {
    const missing = PUBLIC_PAGE_ROUTES.filter(route =>
      pageFilesForRoute(route).every(file => !existsSync(file)),
    )
    expect(missing).toEqual([])
  })

  it('排球與網球使用獨立子路徑，避免套用羽球頁面後導覽錯亂', () => {
    expect(SPORT_NAV_LINKS.volleyball.map(link => link.to)).toEqual([
      '/volleyball',
      '/volleyball/bets',
      '/volleyball/tsl-sync',
      '/volleyball/matches',
    ])
    expect(SPORT_NAV_LINKS.tennis.map(link => link.to)).toEqual([
      '/tennis',
      '/tennis/bets',
      '/tennis/tsl-sync',
      '/tennis/matches',
    ])
  })

  it('書籤小工具會抓羽球、排球、網球', () => {
    const source = decodeURIComponent(buildTslBookmarklet('http://localhost:3000'))
    expect(source).toContain('BAD')
    expect(source).toContain('VOL')
    expect(source).toContain('TEN')
  })
})
