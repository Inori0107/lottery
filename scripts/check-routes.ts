import { existsSync } from 'node:fs'
import { PUBLIC_GET_API_ROUTES, PUBLIC_PAGE_ROUTES, pageFilesForRoute } from '../shared/nav'

const base = (process.env.CHECK_ROUTES_BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const timeoutMs = Number(process.env.CHECK_ROUTES_TIMEOUT_MS ?? 8000)

const missingPages = PUBLIC_PAGE_ROUTES.filter(route =>
  pageFilesForRoute(route).every(file => !existsSync(file)),
)
if (missingPages.length > 0) {
  console.error(`缺少頁面檔：${missingPages.join(', ')}`)
  process.exit(1)
}
console.log(`頁面檔案：${PUBLIC_PAGE_ROUTES.length} 條導覽路由都有對應 Vue 檔`)

const fetchStatus = async (path: string, init?: RequestInit) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${base}${path}`, { redirect: 'manual', signal: controller.signal, ...init })
    return { ok: response.status >= 200 && response.status < 400, status: response.status }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, status: 0, reason }
  } finally {
    clearTimeout(timer)
  }
}

const failures: string[] = []

for (const route of PUBLIC_PAGE_ROUTES) {
  const result = await fetchStatus(route)
  if (!result.ok) {
    failures.push(`${route} → ${result.status}${result.reason ? ` ${result.reason}` : ''}`)
    continue
  }
  console.log(`OK  ${result.status}  ${route}`)
}

for (const route of PUBLIC_GET_API_ROUTES) {
  const result = await fetchStatus(route)
  if (!result.ok) {
    failures.push(`${route} → ${result.status}${result.reason ? ` ${result.reason}` : ''}`)
    continue
  }
  console.log(`OK  ${result.status}  ${route}`)
}

const quoteChecks: Array<{ path: string, body: Record<string, unknown> }> = [
  {
    path: '/api/volleyball/quote',
    body: {
      discipline: 'M',
      awayTeamId: 'Italy',
      homeTeamId: 'Poland',
      matchOdds: { away: 1.8, home: 2.0 },
      set1Odds: { away: 1.7, home: 2.1 },
      totalOdds: { line: 175.5, over: 1.9, under: 1.9 },
    },
  },
]

const playersResponse = await fetch(`${base}/api/players?discipline=MS`)
if (playersResponse.ok) {
  const players = await playersResponse.json() as Array<{ id: string }>
  if (players[0] && players[1] && players[0].id !== players[1].id) {
    quoteChecks.push({
      path: '/api/quote',
      body: {
        discipline: 'MS',
        awayPlayerId: players[0].id,
        homePlayerId: players[1].id,
        matchOdds: { away: 1.8, home: 2.0 },
        game1Odds: { away: 1.7, home: 2.1 },
      },
    })
  }
}

for (const check of quoteChecks) {
  const result = await fetchStatus(check.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(check.body),
  })
  if (!result.ok) {
    failures.push(`POST ${check.path} → ${result.status}${result.reason ? ` ${result.reason}` : ''}`)
    continue
  }
  console.log(`OK  ${result.status}  POST ${check.path}`)
}

if (failures.length > 0) {
  console.error(`\n失敗 ${failures.length} 條：`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`\n全部通過：${PUBLIC_PAGE_ROUTES.length} 頁、${PUBLIC_GET_API_ROUTES.length} 個 GET API、${quoteChecks.length} 個報價 POST`)
