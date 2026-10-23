<template>
  <div>
    <h1 class="text-2xl font-semibold">運彩賠率同步</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      運彩的資料有 Cloudflare 保護，伺服器直接抓會被擋，所以由你的瀏覽器在運彩頁面讀取當天羽球、排球、網球賽事與賠率，再送回這個 App。只讀賠率，不會登入或下注。
    </p>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="設定步驟">
      <h2 class="text-base font-semibold">第一次設定</h2>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-700">
        <li>把下面的按鈕拖到瀏覽器書籤列；或按「複製書籤網址」，新增書籤後把網址貼上。若你之前已安裝過，請刪掉舊書籤再裝一次。</li>
        <li>打開 <a :href="`${TSL_ORIGIN}/daily-coupons`" target="_blank" rel="noopener" class="underline focus:outline-none focus-visible:ring-2" :class="ringClass">運彩投注頁</a>（不要開官網首頁，那裡是內嵌頁面，讀不到資料）。</li>
        <li>允許這個網站開啟彈出視窗。書籤必須開一個 App 分頁才能把資料送回來；從 HTTPS 運彩頁無法直接寫入 HTTP 本機。</li>
        <li>在運彩投注頁按這個書籤。它會開啟（或重新整理）這一頁，並把當天賠率送過來。</li>
        <li>兩個分頁都開著時，每 20 分鐘會自動再送一次，累積賠率變化與收盤賠率。</li>
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

    <section v-if="lastResult" class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="本次同步結果">
      <h2 class="text-base font-semibold">本次同步結果</h2>
      <p class="mt-2 text-sm text-stone-800">{{ lastResult.headline }}</p>
      <p v-if="lastResult.detail" class="mt-1 text-sm text-stone-600">{{ lastResult.detail }}</p>
    </section>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="同步紀錄">
      <h2 class="text-base font-semibold">同步紀錄</h2>
      <p v-if="!hasOpener" class="mt-1 text-xs text-stone-500">這一頁不是由書籤開啟，收不到運彩資料。請在運彩投注頁按書籤。</p>
      <p v-else class="mt-1 text-xs text-stone-500">已連上運彩投注頁，請保持兩個分頁開著。</p>
      <p v-if="logs.length === 0" class="mt-3 text-sm text-stone-500">還沒有收到資料。</p>
      <ul v-else class="mt-3 divide-y divide-stone-100 text-sm" aria-live="polite">
        <li v-for="log in logs" :key="log.id" class="py-2">
          <p :class="{ 'text-rose-700': log.error, 'text-stone-800': !log.error }">
            {{ formatTaipeiTime(log.at) }}：{{ log.message }}
          </p>
          <p v-if="log.detail" class="mt-1 wrap-break-word text-xs text-stone-500">{{ log.detail }}</p>
        </li>
      </ul>
      <NuxtLink :to="homePath" class="mt-3 inline-block text-sm underline focus:outline-none focus-visible:ring-2" :class="ringClass">回到計算頁</NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Sport, TslImportSummary } from '~~/shared/types'
import { TSL_ORIGIN, TSL_IMPORT_CHANNEL, buildTslBookmarklet, type TslSyncMessage } from '~/utils/tslBookmarklet'

const props = defineProps<{
  sport: Sport
  homePath: string
}>()

type SyncLog = {
  id: number
  at: string
  message: string
  detail: string
  error: boolean
}

const buttonClass = computed(() => {
  if (props.sport === 'volleyball') return 'bg-orange-700 focus:ring-orange-700'
  if (props.sport === 'tennis') return 'bg-lime-800 focus:ring-lime-800'
  return 'bg-emerald-800 focus:ring-emerald-700'
})
const ringClass = computed(() => {
  if (props.sport === 'volleyball') return 'focus-visible:ring-orange-700 focus:ring-orange-700'
  if (props.sport === 'tennis') return 'focus-visible:ring-lime-800 focus:ring-lime-800'
  return 'focus-visible:ring-emerald-700'
})

const bookmarklet = ref('')
const copyMessage = ref('')
const hasOpener = ref(false)
const logs = ref<SyncLog[]>([])
const lastResult = ref<{ headline: string, detail: string } | null>(null)
let nextLogId = 0
let readyTimer: ReturnType<typeof setInterval> | undefined

const addLog = (message: string, detail = '', error = false) => {
  nextLogId += 1
  logs.value = [{ id: nextLogId, at: new Date().toISOString(), message, detail, error }, ...logs.value].slice(0, 50)
}

const describeImport = (result: TslImportSummary) => {
  const parts: string[] = []
  if (result.unlinked.length > 0) parts.push(`對不上資料庫選手：${[...new Set(result.unlinked)].join('、')}`)
  if (result.skipped.length > 0) {
    parts.push(`略過 ${result.skipped.length} 場：${result.skipped.map(item => `${item.name}（${item.reason}）`).join('、')}`)
  }
  if (result.received === 0) {
    parts.push('書籤沒有從運彩頁抓到場次。請確認在 daily-coupons 投注頁執行、允許彈出視窗，並重新安裝書籤。')
  }
  return parts.join('。')
}

const importPayload = async (payload: Record<string, unknown>) => {
  try {
    const result = await $fetch<TslImportSummary>('/api/tsl/import', { method: 'POST', body: payload })
    const headline = `收到 ${result.received} 場，匯入 ${result.imported} 場，略過 ${result.skipped.length} 場，新增 ${result.snapshots} 筆賠率`
    const detail = describeImport(result)
    lastResult.value = { headline, detail }
    addLog(headline, detail)
    const channel = new BroadcastChannel(TSL_IMPORT_CHANNEL)
    channel.postMessage('imported')
    channel.close()
  } catch (error) {
    lastResult.value = { headline: '匯入失敗', detail: apiErrorMessage(error, String(error)) }
    addLog('匯入失敗', apiErrorMessage(error, String(error)), true)
  }
}

const handleMessage = (event: MessageEvent<TslSyncMessage>) => {
  if (event.origin !== TSL_ORIGIN) return
  if (event.data?.type === 'tsl-payload') {
    if (readyTimer) {
      window.clearInterval(readyTimer)
      readyTimer = undefined
    }
    void importPayload(event.data.payload)
    return
  }
  if (event.data?.type === 'tsl-error') addLog('運彩頁讀取失敗', event.data.message, true)
}

const handleBookmarkletClick = () => {
  copyMessage.value = '請把按鈕拖到書籤列，在運彩投注頁按它。若已安裝過舊書籤，請先刪掉再裝一次。'
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
  const sendReady = () => {
    const ready: TslSyncMessage = { type: 'tsl-ready' }
    window.opener?.postMessage(ready, TSL_ORIGIN)
  }
  sendReady()
  readyTimer = window.setInterval(sendReady, 1000)
  window.setTimeout(() => {
    if (readyTimer) {
      window.clearInterval(readyTimer)
      readyTimer = undefined
    }
  }, 60_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
  if (readyTimer) window.clearInterval(readyTimer)
})
</script>
