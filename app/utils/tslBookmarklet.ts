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
    idfosporttype?: string
    idfosport?: string
    tsstart: string
    participantname_away: string
    participantname_home: string
  }
  type NavigationNode = {
    idfwbonavigation: string
    focontentid?: string
    idfosporttype?: string
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

  const mixedContent = location.protocol === 'https:' && appOrigin.startsWith('http:')
  let target: Window | null = null
  let direct = false
  let ready = false

  const getContent = async (type: string, id: string, language: string) => {
    const response = await fetch('/services/content/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentId: { type, id }, clientContext: { language, ipAddress: '0.0.0.0' } }),
    })
    if (!response.ok) throw new Error(`${type} 回應 HTTP ${response.status}`)
    return response.json() as Promise<{ data?: unknown }>
  }
  const parseTs = (value: string) => {
    const text = String(value ?? '').trim()
    if (!text) return new Date(Number.NaN)
    if (/^\d{8}$/.test(text)) return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00+08:00`)
    const iso = text.includes('T') ? text : text.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) return new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00+08:00`)
    return new Date(`${iso}+08:00`)
  }
  const taipeiDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const pick = (type: string) => parts.find(part => part.type === type)?.value ?? ''
    return `${pick('year')}${pick('month')}${pick('day')}`
  }
  const shiftDay = (compact: string, days: number) => {
    const utc = Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)) + days)
    const next = new Date(utc)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`
  }
  const today = taipeiDay(new Date())
  const couponDays = new Set([shiftDay(today, -1), today, shiftDay(today, 1)])
  const inWindow = (tsstart: string) => {
    const date = parseTs(tsstart)
    if (Number.isNaN(date.getTime())) return true
    return couponDays.has(taipeiDay(date))
  }
  const sportCode = (value: string | undefined) => {
    const text = String(value ?? '').toUpperCase()
    if (text === 'BAD' || text.startsWith('BAD') || text === 'BDM' || text.includes('BADMINTON') || text.includes('羽球')) return 'BAD'
    if (text === 'VOL' || text.startsWith('VOL') || text === 'VB' || text.includes('VOLLEY') || text.includes('排球')) return 'VOL'
    if (text === 'TEN' || text === 'TE' || text === 'TENN' || text.startsWith('TEN') || text.includes('網球')) return 'TEN'
    return ''
  }
  const isTargetEvent = (event: TslEvent) =>
    Boolean(sportCode(event.idfosporttype) || sportCode(event.idfosport)) && inWindow(event.tsstart)
  const navigation = async (id: string) =>
    (await getContent('boNavigationList', `1/${id}`, 'ZH')).data as NavigationNode | undefined
  const findSports = (node: NavigationNode): NavigationNode[] => {
    const id = node.focontentid ?? node.idfosporttype ?? ''
    const types = node.idfwbonavigationtypes ?? []
    const isSport = types.includes('SPORT') || types.includes('SPORTS') || types.length === 0
    if (sportCode(id) && isSport) return [node]
    return (node.bonavigationnodes ?? []).flatMap(findSports)
  }
  const listCouponGroups = async () => {
    const top = await navigation('top')
    const queue = top ? findSports(top) : []
    if (queue.length === 0 && top) queue.push(top)
    const groupIds = new Set<string>()
    while (queue.length > 0) {
      const node = queue.shift()!
      const detail = await navigation(node.idfwbonavigation)
      const current = detail ?? node
      for (const group of current.marketgroups ?? []) {
        if (group.idfwmarketgrouptype === 'MATCHESCOUPON') groupIds.add(group.idfwmarketgroup)
      }
      queue.push(...(current.bonavigationnodes ?? []))
    }
    return [...groupIds]
  }
  const listEvents = async (groupIds: string[], language: string) => {
    const events: TslEvent[] = []
    for (const groupId of groupIds) {
      try {
        const group = (await getContent('eventGroup', groupId, language)).data as { events?: TslEvent[] } | undefined
        events.push(...(group?.events ?? []))
      } catch {
        continue
      }
    }
    return events
  }
  const collect = async () => {
    const groupIds = await listCouponGroups()
    const chinese = (await listEvents(groupIds, 'ZH')).filter(isTargetEvent)
    const englishById = new Map<string, TslEvent>()
    for (const language of ['UK', 'EN']) {
      const listed = await listEvents(groupIds, language)
      for (const event of listed) {
        if (!englishById.has(event.idfoevent) && event.participantname_away && event.participantname_home) {
          englishById.set(event.idfoevent, event)
        }
      }
    }
    const events: unknown[] = []
    for (const event of chinese) {
      try {
        const response = await getContent('event', event.idfoevent, 'ZH')
        const detail = Array.isArray(response.data) ? response.data[0] : response.data
        if (detail) events.push(detail)
      } catch {
        events.push(event)
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return {
      capturedAt: new Date().toISOString(),
      date: today,
      english: chinese.map((event) => {
        const names = englishById.get(event.idfoevent)
        return {
          idfoevent: event.idfoevent,
          participantname_away: names?.participantname_away || event.participantname_away,
          participantname_home: names?.participantname_home || event.participantname_home,
        }
      }),
      events,
    }
  }

  let running = false
  let notified = false
  const describeSummary = (summary: { received?: number, imported?: number, fixtures?: number, skipped?: unknown[] }) => {
    const received = summary.received ?? 0
    const imported = summary.imported ?? summary.fixtures ?? 0
    const skipped = Array.isArray(summary.skipped) ? summary.skipped.length : 0
    return `運彩頁找到 ${received} 場，匯入 ${imported} 場，略過 ${skipped} 場。回到計算頁重新整理即可看到。`
  }
  const postDirectly = async () => {
    try {
      const response = await fetch(`${appOrigin}/api/tsl/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await collect()),
      })
      if (!response.ok) throw new Error(`匯入回應 HTTP ${response.status}`)
      const summary = await response.json() as { received?: number, imported?: number, fixtures?: number, skipped?: unknown[] }
      if (!notified) window.alert(describeSummary(summary))
    } catch (error) {
      if (!notified) {
        window.alert(`同步失敗：${String(error)}。請確認 App 有在 ${appOrigin} 執行，允許彈出視窗，並重新安裝書籤小工具。HTTPS 運彩頁無法直接寫入 HTTP 本機，必須靠彈出視窗。`)
      }
    }
    notified = true
  }
  const isAlive = () => direct || Boolean(target && !target.closed)
  const run = async () => {
    if (running || !isAlive()) return
    running = true
    try {
      if (direct || !target) {
        if (mixedContent) {
          if (!notified) window.alert(`無法直接從運彩頁寫入 ${appOrigin}（混合內容）。請允許這個網站開啟彈出視窗，再按一次書籤。`)
          notified = true
          return
        }
        await postDirectly()
        return
      }
      target.postMessage({ type: 'tsl-payload', payload: await collect() }, appOrigin)
    } catch (error) {
      target?.postMessage({ type: 'tsl-error', message: String(error) }, appOrigin)
      if (!target && !notified) window.alert(`同步失敗：${String(error)}`)
    } finally {
      running = false
    }
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== appOrigin) return
    if (target && event.source !== target) return
    if ((event.data as { type?: string } | null)?.type !== 'tsl-ready') return
    ready = true
    direct = false
    void run()
  })
  target = window.open(`${appOrigin}/tsl-sync`, 'lottery-tsl-sync')
  if (!target) {
    if (mixedContent) {
      window.alert(`瀏覽器擋下彈出視窗。HTTPS 運彩頁無法直接寫入 ${appOrigin}，請允許彈出視窗後再按一次書籤。`)
      notified = true
    } else {
      direct = true
      void run()
    }
  } else {
    window.setTimeout(() => {
      if (ready) return
      if (mixedContent) {
        if (!notified) window.alert('同步頁還沒回應。請不要關掉彈出的 App 分頁，或允許彈出視窗後再按一次書籤。')
        notified = true
        return
      }
      direct = true
      void run()
    }, 20_000)
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
