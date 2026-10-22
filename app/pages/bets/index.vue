<template>
  <div>
    <h1 class="text-2xl font-semibold">投注紀錄</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      有對上運彩場次的投注，會在 StatsHub 出現完賽比分後自動結算（約每 20 分鐘一次，也可以按下方按鈕立即執行）。棄權或取消算作廢、退回本金。CLV 是下注賠率比開賽前最後一次匯入的賠率高多少，長期為正才代表真的比市場早一步。
    </p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50"
        :disabled="settling"
        aria-label="同步賽果並結算"
        @click="handleSettle"
      >
        同步賽果並結算
      </button>
      <span class="text-sm text-stone-600" aria-live="polite">{{ settleMessage }}</span>
    </div>
    <p v-if="errorMessage" class="mt-3 text-sm text-rose-700" role="alert">{{ errorMessage }}</p>

    <template v-if="data">
      <BetStatsCard class="mt-6" title="全部" :stats="data.summary.all" />

      <div v-if="data.summary.byMarket.length > 0 || data.summary.byAction.length > 0" class="mt-4 grid gap-4 lg:grid-cols-2">
        <section class="min-w-0 overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4" aria-label="依玩法">
          <h2 class="text-base font-semibold">依玩法</h2>
          <BetStatsTable class="mt-2" :rows="marketRows" />
        </section>
        <section class="min-w-0 overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4" aria-label="依模型動作">
          <h2 class="text-base font-semibold">依模型動作</h2>
          <BetStatsTable class="mt-2" :rows="actionRows" />
        </section>
      </div>

      <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="投注明細">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <h2 class="text-base font-semibold">明細（{{ filteredBets.length }}）</h2>
          <div class="flex flex-wrap gap-3">
            <label class="text-xs text-stone-500">
              狀態
              <select v-model="statusFilter" class="mt-1 block rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900" aria-label="依狀態篩選">
                <option value="">全部</option>
                <option v-for="status in BET_STATUSES" :key="status" :value="status">{{ statusLabel[status] }}</option>
              </select>
            </label>
            <label class="text-xs text-stone-500">
              玩法
              <select v-model="marketFilter" class="mt-1 block rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900" aria-label="依玩法篩選">
                <option value="">全部</option>
                <option v-for="market in BET_MARKETS" :key="market" :value="market">{{ betMarketLabel[market] }}</option>
              </select>
            </label>
          </div>
        </div>

        <p v-if="filteredBets.length === 0" class="mt-4 text-sm text-stone-500">沒有符合的投注。在計算頁按「記錄投注」就會出現在這裡。</p>
        <ul v-else class="mt-3 divide-y divide-stone-100">
          <li v-for="bet in filteredBets" :key="bet.id" class="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
            <div class="min-w-0">
              <p class="text-xs text-stone-500">
                下注 {{ formatTaipeiTime(bet.placedAt) }}
                <span v-if="bet.startsAt"> · 開賽 {{ formatTaipeiTime(bet.startsAt) }}</span>
                · {{ disciplineLabel[bet.discipline] }}
              </p>
              <p class="wrap-break-word font-medium">{{ bet.awayName }} 對 {{ bet.homeName }}</p>
              <p class="wrap-break-word">
                {{ betMarketLabel[bet.market] }}：{{ bet.outcomeLabel }} @ {{ bet.odds }} × {{ bet.stake }}
                <span class="ml-1 rounded-full px-2 py-0.5 text-xs" :class="statusClass[bet.status]">{{ statusLabel[bet.status] }}</span>
              </p>
              <p class="text-xs text-stone-500">
                校準機率 {{ formatPercent(bet.probability) }}，期望值 {{ formatPercent(bet.ev) }}，模型 {{ bet.action ? marketActionLabel[bet.action] : '—' }}
                <span v-if="bet.status !== 'open'">，派彩 {{ bet.payout ?? '—' }}</span>
                <span v-if="bet.closingOdds !== null">，收盤 {{ bet.closingOdds }}（去水 {{ formatPercent(bet.closingMarket) }}），CLV {{ formatPercent(bet.clv) }}</span>
                <span v-if="bet.fixtureId === null">，未對上運彩場次，需手動結算</span>
              </p>
              <p v-if="bet.note" class="wrap-break-word text-xs text-stone-600">備註：{{ bet.note }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <label class="sr-only" :for="`status-${bet.id}`">修改狀態</label>
              <select
                :id="`status-${bet.id}`"
                :value="bet.status"
                class="rounded-lg border border-stone-300 px-2 py-1 text-sm"
                :aria-label="`修改 ${bet.outcomeLabel} 的狀態`"
                @change="event => handleStatusChange(bet, event)"
              >
                <option v-for="status in BET_STATUSES" :key="status" :value="status">{{ statusLabel[status] }}</option>
              </select>
              <button
                type="button"
                class="rounded-lg border border-rose-200 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-600"
                :aria-label="`刪除 ${bet.awayName} 對 ${bet.homeName} ${bet.outcomeLabel} 的投注`"
                @click="handleDelete(bet)"
              >
                刪除
              </button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { BET_MARKETS, BET_STATUSES, betMarketLabel, type BetAction, type BetMarket, type BetRecord, type BetsResponse, type BetStatus } from '~~/shared/types'
import { marketActionLabel } from '~~/shared/decision'

useHead({ title: '投注紀錄' })

const statusLabel: Record<BetStatus, string> = { open: '未結算', won: '贏', lost: '輸', void: '作廢' }

const statusClass: Record<BetStatus, string> = {
  open: 'bg-stone-100 text-stone-700',
  won: 'bg-emerald-100 text-emerald-900',
  lost: 'bg-rose-100 text-rose-800',
  void: 'bg-amber-100 text-amber-900',
}

const actionLabel = (action: BetAction | 'none') => (action === 'none' ? '沒有模型' : marketActionLabel[action])

const { data, refresh } = await useFetch<BetsResponse>('/api/bets')
const statusFilter = ref<BetStatus | ''>('')
const marketFilter = ref<BetMarket | ''>('')
const errorMessage = ref('')
const settleMessage = ref('')
const settling = ref(false)

const filteredBets = computed(() => (data.value?.bets ?? []).filter(bet => (
  (!statusFilter.value || bet.status === statusFilter.value)
  && (!marketFilter.value || bet.market === marketFilter.value)
)))

const marketRows = computed(() => (data.value?.summary.byMarket ?? []).map(group => ({ label: betMarketLabel[group.market], stats: group.stats })))

const actionRows = computed(() => (data.value?.summary.byAction ?? []).map(group => ({ label: actionLabel(group.action), stats: group.stats })))

const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)

const handleStatusChange = async (bet: BetRecord, event: Event) => {
  errorMessage.value = ''
  const status = (event.target as HTMLSelectElement).value as BetStatus
  try {
    await $fetch(`/api/bets/${bet.id}`, { method: 'PATCH', body: { status } })
    await refresh()
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '修改失敗')
  }
}

const handleDelete = async (bet: BetRecord) => {
  if (!window.confirm(`確定刪除 ${bet.awayName} 對 ${bet.homeName} 的「${bet.outcomeLabel}」？`)) return
  errorMessage.value = ''
  try {
    await $fetch(`/api/bets/${bet.id}`, { method: 'DELETE' })
    await refresh()
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '刪除失敗')
  }
}

const handleSettle = async () => {
  errorMessage.value = ''
  settleMessage.value = '同步中…'
  settling.value = true
  try {
    const result = await $fetch<{ updated: number, settled: number, errors: string[] }>('/api/bets/settle', { method: 'POST' })
    settleMessage.value = `更新 ${result.updated} 場賽果，結算 ${result.settled} 筆投注${result.errors.length > 0 ? `；${result.errors.join('、')}` : ''}`
    await refresh()
  } catch (error) {
    settleMessage.value = ''
    errorMessage.value = apiErrorMessage(error, '同步失敗')
  } finally {
    settling.value = false
  }
}
</script>
