<template>
  <div>
    <h1 class="text-2xl font-semibold">運彩賠率同步</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      運彩的資料有 Cloudflare 保護，伺服器直接抓會被擋，所以由你的瀏覽器在運彩頁面讀取當天所有已支援球種（羽球、排球、網球）的賽事與賠率，再送回這個 App。只讀賠率，不會登入或下注。書籤一律開啟全域同步頁。
    </p>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="設定步驟">
      <h2 class="text-base font-semibold">第一次設定</h2>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-700">
        <li>把下面的按鈕拖到瀏覽器書籤列；或按「複製書籤網址」，新增書籤後把網址貼上。</li>
        <li>打開 <a :href="`${TSL_ORIGIN}/daily-coupons`" target="_blank" rel="noopener" class="underline focus:outline-none focus-visible:ring-2" :class="ringClass">運彩投注頁</a>（不要開官網首頁，那裡是內嵌頁面，讀不到資料）。</li>
        <li>在運彩投注頁按這個書籤。它會開啟（或重新整理）這一頁，並把當天賠率送過來。</li>
        <li>兩個分頁都開著時，每 20 分鐘會自動再送一次，累積賠率變化與收盤賠率。</li>
        <li>如果瀏覽器擋下新視窗，書籤會改成直接把資料送到 App，並跳出匯入結果；之後回計算頁重新整理即可。</li>
      </ol>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <a
          v-if="bookmarklet"
          :href="bookmarklet"
          class="rounded-lg px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2"
          :class="buttonClass"
          aria-label="運彩賠率同步書籤，請拖到書籤列"
          @click.prevent="handleBookmarkletClick"
        >
          運彩賠率同步
        </a>
        <button
          type="button"
          class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2"
          :class="ringClass"
          aria-label="複製書籤網址"
          @click="handleCopy"
        >
          複製書籤網址
        </button>
        <span class="text-xs text-stone-500" aria-live="polite">{{ copyMessage }}</span>
      </div>
    </section>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="同步紀錄">
      <h2 class="text-base font-semibold">同步紀錄</h2>
      <p v-if="!hasOpener" class="mt-1 text-xs text-stone-500">這一頁不是由書籤開啟，收不到運彩資料。請在運彩投注頁按書籤。</p>
      <p v-else class="mt-1 text-xs text-stone-500">已連上運彩投注頁，請保持兩個分頁開著。抓取當天羽球、排球、網球通常要一兩分鐘。</p>
      <p v-if="progress" class="mt-3 text-sm text-stone-800" role="status">{{ progress }}</p>
      <p v-else-if="logs.length === 0" class="mt-3 text-sm text-stone-500">
        還沒有收到資料。若超過半分鐘仍沒進度，請先複製最新書籤，重新整理運彩投注頁後再按一次。
      </p>
      <ul v-else class="mt-3 divide-y divide-stone-100 text-sm" aria-live="polite">
        <li v-for="log in logs" :key="log.id" class="py-2">
          <p :class="{ 'text-rose-700': log.error, 'text-stone-800': !log.error }">
            {{ formatTaipeiTime(log.at) }}：{{ log.message }}
          </p>
          <p v-if="log.detail" class="mt-1 wrap-break-word text-xs text-stone-500">{{ log.detail }}</p>
        </li>
      </ul>
      <NuxtLink :to="homePath" class="mt-3 inline-block text-sm underline focus:outline-none focus-visible:ring-2" :class="ringClass">{{ homeLabel }}</NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Sport } from '~~/shared/types'
import { SPORT_BASE_PATH } from '~~/shared/nav'
import { TSL_ORIGIN, TSL_IMPORT_CHANNEL, buildTslBookmarklet, type TslSyncMessage } from '~/utils/tslBookmarklet'

const props = defineProps<{
  sport?: Sport
}>()

const homePath = computed(() => (props.sport ? SPORT_BASE_PATH[props.sport] : '/'))
const homeLabel = computed(() => (props.sport ? '回到計算頁' : '回到選擇運動'))
const theme = computed(() => {
  if (props.sport === 'volleyball') return { button: 'bg-orange-700 focus:ring-orange-700', ring: 'focus-visible:ring-orange-700 focus:ring-orange-700' }
  if (props.sport === 'tennis') return { button: 'bg-lime-800 focus:ring-lime-700', ring: 'focus-visible:ring-lime-700 focus:ring-lime-700' }
  if (props.sport === 'badminton') return { button: 'bg-emerald-800 focus:ring-emerald-700', ring: 'focus-visible:ring-emerald-700 focus:ring-emerald-700' }
  return { button: 'bg-stone-900 focus:ring-stone-900', ring: 'focus-visible:ring-stone-900 focus:ring-stone-900' }
})
const buttonClass = computed(() => theme.value.button)
const ringClass = computed(() => theme.value.ring)

type ImportResult = {
  marketStats?: { available: number, unavailable: number, unsupported: number, invalid: number }
  fixtures: number
  snapshots: number
  unlinked: string[]
  skipped: Array<{ name: string, reason: string }>
  sports?: { badminton: number, volleyball: number, tennis: number }
  received?: number
  listed?: number
  groups?: number | null
}

type SyncLog = {
  id: number
  at: string
  message: string
  detail: string
  error: boolean
}

const bookmarklet = ref('')
const copyMessage = ref('')
const hasOpener = ref(false)
const progress = ref('')
const logs = ref<SyncLog[]>([])
let nextLogId = 0
const pingTimers: number[] = []

const addLog = (message: string, detail = '', error = false) => {
  nextLogId += 1
  logs.value = [{ id: nextLogId, at: new Date().toISOString(), message, detail, error }, ...logs.value].slice(0, 50)
}

const describeImport = (result: ImportResult) => {
  const parts: string[] = []
  if (result.marketStats) {
    const m = result.marketStats
    parts.push(`市場：可計算 ${m.available}、停賣 ${m.unavailable}、未支援 ${m.unsupported}、格式不完整 ${m.invalid}`)
  }
  if (result.sports) {
    parts.push(`羽球 ${result.sports.badminton}、排球 ${result.sports.volleyball}、網球 ${result.sports.tennis}`)
    if (result.sports.volleyball === 0 && result.fixtures > 0) {
      parts.push('這次沒有排球場次。若運彩有排球盤，請複製最新書籤後再同步（排球代碼是 VBL）')
    }
  }
  if (result.fixtures === 0) {
    const listed = result.listed ?? result.received ?? 0
    if (listed === 0) {
      parts.push('書籤沒抓到羽球／排球／網球場次。請確認書籤是最新版，並在運彩投注頁（不是官網內嵌頁）再按一次。')
    } else {
      parts.push(`書籤送來 ${listed} 筆，但沒有可寫入場次`)
    }
  }
  if (result.unlinked.length > 0) parts.push(`對不上資料庫選手：${[...new Set(result.unlinked)].join('、')}`)
  if (result.skipped.length > 0) parts.push(`略過：${result.skipped.map(item => `${item.name}（${item.reason}）`).join('、')}`)
  return parts.join('。')
}

const stopReadyPings = () => {
  for (const timer of pingTimers) window.clearTimeout(timer)
  pingTimers.length = 0
}

const importPayload = async (payload: Record<string, unknown>) => {
  progress.value = '正在寫入資料庫…'
  try {
    const result = await $fetch<ImportResult>('/api/tsl/import', { method: 'POST', body: payload })
    progress.value = ''
    addLog(`匯入 ${result.fixtures} 場，新增 ${result.snapshots} 筆賠率`, describeImport(result))
    const channel = new BroadcastChannel(TSL_IMPORT_CHANNEL)
    channel.postMessage('imported')
    channel.close()
  } catch (error) {
    progress.value = ''
    addLog('匯入失敗', apiErrorMessage(error, String(error)), true)
  }
}

const handleMessage = (event: MessageEvent<TslSyncMessage>) => {
  if (event.origin !== TSL_ORIGIN) return
  if (event.data?.type === 'tsl-status') {
    progress.value = event.data.message
    return
  }
  if (event.data?.type === 'tsl-payload') {
    stopReadyPings()
    void importPayload(event.data.payload)
    return
  }
  if (event.data?.type === 'tsl-error') {
    progress.value = ''
    addLog('運彩頁讀取失敗', event.data.message, true)
  }
}

const handleBookmarkletClick = () => {
  copyMessage.value = '請把按鈕拖到書籤列，在運彩投注頁按它'
}

const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(bookmarklet.value)
    copyMessage.value = '已複製，新增書籤時貼到網址欄'
  } catch {
    copyMessage.value = '無法複製，請改用拖曳'
  }
}

onMounted(() => {
  bookmarklet.value = buildTslBookmarklet(window.location.origin)
  window.addEventListener('message', handleMessage)
  hasOpener.value = Boolean(window.opener)
  if (!window.opener) return
  const pingReady = () => {
    if (!window.opener) return
    const ready: TslSyncMessage = { type: 'tsl-ready' }
    window.opener.postMessage(ready, TSL_ORIGIN)
  }
  pingReady()
  for (const delay of [1000, 3000, 8000]) pingTimers.push(window.setTimeout(pingReady, delay))
})

onBeforeUnmount(() => {
  stopReadyPings()
  window.removeEventListener('message', handleMessage)
})
</script>
