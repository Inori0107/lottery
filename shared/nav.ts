import type { Sport } from './sports'

export type NavLink = { to: string, label: string }

export const SPORT_NAV_LINKS: Record<Sport, readonly NavLink[]> = {
  badminton: [
    { to: '/', label: '計算' },
    { to: '/bets', label: '投注紀錄' },
    { to: '/tsl-sync', label: '賠率同步' },
    { to: '/matches', label: '已匯入賽事' },
  ],
  volleyball: [
    { to: '/volleyball', label: '計算' },
    { to: '/volleyball/bets', label: '投注紀錄' },
    { to: '/volleyball/tsl-sync', label: '賠率同步' },
    { to: '/volleyball/matches', label: '已匯入賽事' },
  ],
  tennis: [
    { to: '/tennis', label: '計算' },
    { to: '/tennis/bets', label: '投注紀錄' },
    { to: '/tennis/tsl-sync', label: '賠率同步' },
    { to: '/tennis/matches', label: '已匯入賽事' },
  ],
}

export const PUBLIC_PAGE_ROUTES = [
  '/sport',
  ...SPORT_NAV_LINKS.badminton.map(link => link.to),
  ...SPORT_NAV_LINKS.volleyball.map(link => link.to),
  ...SPORT_NAV_LINKS.tennis.map(link => link.to),
] as const

export const PUBLIC_GET_API_ROUTES = [
  '/api/status',
  '/api/players?discipline=MS',
  '/api/players?discipline=WS',
  '/api/fixtures',
  '/api/matches',
  '/api/matches?sport=volleyball',
  '/api/matches?sport=tennis',
  '/api/bets',
  '/api/bets?sport=badminton',
  '/api/bets?sport=volleyball',
  '/api/bets?sport=tennis',
  '/api/volleyball/status',
  '/api/volleyball/teams?discipline=M',
  '/api/volleyball/teams?discipline=W',
  '/api/volleyball/fixtures',
  '/api/tennis/status',
  '/api/tennis/players?discipline=ATP',
  '/api/tennis/players?discipline=WTA',
  '/api/tennis/fixtures',
] as const

export const pageFilesForRoute = (route: string) => {
  if (route === '/') return ['app/pages/index.vue']
  return [`app/pages${route}.vue`, `app/pages${route}/index.vue`]
}
