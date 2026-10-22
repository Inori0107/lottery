export const TSL_ORIGIN = 'https://www-talo-ssb-pr.sportslottery.com.tw'

export const TSL_IMPORT_CHANNEL = 'lottery-tsl-import'

export type TslSyncMessage =
  | { type: 'tsl-ready' }
  | { type: 'tsl-payload', payload: Record<string, unknown> }
  | { type: 'tsl-error', message: string }

const tslCollector = (appOrigin: string, sportsbookOrigin: string) => {
  type SyncWindow = Window & { __lotteryTslSync?: { isAlive: () => boolean, run: () => Promise<void> } }
  type TslEvent = {
    idfoevent: string
    idfosporttype: string
    tsstart: string
    participantname_away: string
    participantname_home: string
  }
  type NavigationNode = {
    idfwbonavigation: string
    focontentid?: string
    numevents?: string
    idfwbonavigationtypes?: string[]
    bonavigationnodes?: NavigationNode[]
    marketgroups?: Array<{ idfwmarketgroup: string, idfwmarketgrouptype: string }>
  }
  const page = window as SyncWindow
  const intervalMs = 20 * 60_000
  if (location.origin !== sportsbookOrigin) {
    if (window.confirm('這個書籤要在運彩投注頁執行。現在前往？到了之後請再按一次書籤。')) {
      location.href = `${sportsbookOrigin}/daily-coupons`
    }
    return
  }
  const existing = page.__lotteryTslSync
  if (existing?.isAlive()) {
    void existing.run()
    return
  }
  const target = window.open(`${appOrigin}/tsl-sync`, 'lottery-tsl-sync')

  const getContent = async (type: string, id: string, language: string) => {
    const response = await fetch('/services/content/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentId: { type, id }, clientContext: { language, ipAddress: '0.0.0.0' } }),
    })
    if (!response.ok) throw new Error(`${type} 回應 HTTP ${response.status}`)
    return response.json() as Promise<{ data?: unknown }>
  }
  const taipeiDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).replaceAll('-', '')
  const today = taipeiDay(new Date())
  const navigation = async (id: string) =>
    (await getContent('boNavigationList', `1/${id}`, 'ZH')).data as NavigationNode | undefined
  const findBadminton = (node: NavigationNode): NavigationNode[] => {
    if (node.focontentid === 'BAD' && node.idfwbonavigationtypes?.includes('SPORT')) return [node]
    return (node.bonavigationnodes ?? []).flatMap(findBadminton)
  }
  const listCouponGroups = async () => {
    const top = await navigation('top')
    const queue = top ? findBadminton(top) : []
    const groupIds = new Set<string>()
    while (queue.length > 0) {
      const node = queue.shift()!
      if (Number(node.numevents ?? 0) === 0) continue
      const detail = await navigation(node.idfwbonavigation)
      for (const group of detail?.marketgroups ?? []) {
        if (group.idfwmarketgrouptype === 'MATCHESCOUPON') groupIds.add(group.idfwmarketgroup)
      }
      queue.push(...(detail?.bonavigationnodes ?? []))
    }
    return [...groupIds]
  }
  const listBadminton = async (groupIds: string[], language: string) => {
    const events: TslEvent[] = []
    for (const groupId of groupIds) {
      const group = (await getContent('eventGroup', groupId, language)).data as { events?: TslEvent[] } | undefined
      events.push(...(group?.events ?? []))
    }
    return events.filter(event => event.idfosporttype === 'BAD' && taipeiDay(new Date(event.tsstart)) === today)
  }
  const collect = async () => {
    const groupIds = await listCouponGroups()
    const chinese = await listBadminton(groupIds, 'ZH')
    const english = await listBadminton(groupIds, 'UK')
    const events: unknown[] = []
    for (const event of chinese) {
      const response = await getContent('event', event.idfoevent, 'ZH')
      const detail = Array.isArray(response.data) ? response.data[0] : response.data
      if (detail) events.push(detail)
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return {
      capturedAt: new Date().toISOString(),
      date: today,
      english: english.map(event => ({
        idfoevent: event.idfoevent,
        participantname_away: event.participantname_away,
        participantname_home: event.participantname_home,
      })),
      events,
    }
  }

  let running = false
  let notified = false
  const postDirectly = async () => {
    try {
      const response = await fetch(`${appOrigin}/api/tsl/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await collect()),
      })
      if (!response.ok) throw new Error(`匯入回應 HTTP ${response.status}`)
      const summary = await response.json() as { fixtures: number }
      if (!notified) window.alert(`已匯入 ${summary.fixtures} 場羽球賽事，回到計算頁重新整理即可看到。`)
    } catch (error) {
      if (!notified) window.alert(`同步失敗：${String(error)}。請確認 App 有在 ${appOrigin} 執行，或允許這個網站開啟彈出視窗。`)
    }
    notified = true
  }
  let direct = !target
  const isAlive = () => direct || !target?.closed
  const run = async () => {
    if (running || !isAlive()) return
    running = true
    try {
      if (direct || !target) {
        await postDirectly()
        return
      }
      target.postMessage({ type: 'tsl-payload', payload: await collect() }, appOrigin)
    } catch (error) {
      target?.postMessage({ type: 'tsl-error', message: String(error) }, appOrigin)
    } finally {
      running = false
    }
  }
  if (target) {
    let ready = false
    window.addEventListener('message', (event) => {
      if (event.origin !== appOrigin || event.source !== target) return
      if ((event.data as { type?: string } | null)?.type !== 'tsl-ready') return
      ready = true
      void run()
    })
    window.setTimeout(() => {
      if (ready) return
      direct = true
      void run()
    }, 15_000)
  } else {
    void run()
  }
  const timer = window.setInterval(() => {
    if (!isAlive()) {
      window.clearInterval(timer)
      page.__lotteryTslSync = undefined
      return
    }
    void run()
  }, intervalMs)
  page.__lotteryTslSync = { isAlive, run }
}

// esbuild keepNames may wrap inner functions with __name(), which does not exist on the sportsbook page.
const NAME_HELPER_SHIM = 'const __name=(fn)=>fn;'

export const buildTslBookmarklet = (appOrigin: string) => {
  const invocation = `(${tslCollector.toString()})(${JSON.stringify(appOrigin)},${JSON.stringify(TSL_ORIGIN)})`
  return `javascript:${encodeURIComponent(`(()=>{${NAME_HELPER_SHIM}${invocation}})();void 0`)}`
}
