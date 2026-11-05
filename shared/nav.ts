import type { Sport } from './sports'
import { SPORTS, sportIcon, sportLabel } from './sports'

export type NavLink = { to: string, label: string }

export const SPORT_BASE_PATH: Record<Sport, string> = {
  badminton: '/badminton',
  volleyball: '/volleyball',
  football: '/football',
}

const SPORT_NAV_ITEMS = [
  { suffix: '', label: '計算' },
  { suffix: '/bets', label: '投注紀錄' },
  { suffix: '/parlay', label: '過關' },
  { suffix: '/review', label: '覆盤' },
  { suffix: '/tsl-sync', label: '賠率同步' },
  { suffix: '/matches', label: '已匯入賽事' },
] as const

export const SPORT_NAV_LINKS = Object.fromEntries(
  SPORTS.map(sport => [
    sport,
    SPORT_NAV_ITEMS.map(item => ({
      to: `${SPORT_BASE_PATH[sport]}${item.suffix}`,
      label: item.label,
    })),
  ]),
) as Record<Sport, readonly NavLink[]>

export const LEGACY_REDIRECTS = {
  '/sport': '/',
  '/bets': '/badminton/bets',
  '/matches': '/badminton/matches',
  '/parlay': '/badminton/parlay',
  '/review': '/badminton/review',
} as const

export const sportFromPath = (path: string): Sport | null =>
  SPORTS.find((sport) => {
    const base = SPORT_BASE_PATH[sport]
    return path === base || path.startsWith(`${base}/`)
  }) ?? null

export const sportTitle = (sport: Sport | null) => {
  if (!sport) return '投注估計'
  return `${sportLabel[sport]}對局估計 ${sportIcon[sport]}`
}

export const sportActiveClass = (sport: Sport | null) => {
  if (sport === 'volleyball') return 'bg-orange-700 text-white'
  if (sport === 'football') return 'bg-green-700 text-white'
  return 'bg-stone-900 text-white'
}

export const PUBLIC_PAGE_ROUTES = [
  '/',
  '/tsl-sync',
  ...SPORTS.flatMap(sport => SPORT_NAV_LINKS[sport].map(link => link.to)),
]

export const PUBLIC_GET_API_ROUTES = [
  '/api/status',
  '/api/players?discipline=MS',
  '/api/players?discipline=WS',
  '/api/fixtures',
  '/api/matches',
  '/api/matches?sport=volleyball',
  '/api/matches?sport=football',
  '/api/tickets',
  '/api/tickets?sport=badminton',
  '/api/tickets?sport=football',
  '/api/bankroll',
  '/api/volleyball/status',
  '/api/volleyball/teams?discipline=M',
  '/api/volleyball/teams?discipline=W',
  '/api/volleyball/fixtures',
  '/api/football/status',
  '/api/football/teams?discipline=FM',
  '/api/football/teams?discipline=FW',
  '/api/football/fixtures',
  '/api/review',
  '/api/review/summary',
] as const

export const pageFilesForRoute = (route: string) => {
  if (route === '/') return ['app/pages/index.vue']
  return [`app/pages${route}.vue`, `app/pages${route}/index.vue`]
}
