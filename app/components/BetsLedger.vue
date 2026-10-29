<template>
  <div>
    <h1 class="text-2xl font-semibold">投注紀錄</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      {{ sportLabel[sport] }}場次對上運彩後，會在 StatsHub 出現完賽比分後自動結算。單注與過關分開標示；封存只隱藏列表，仍保留紀錄、結算與損益。研究模擬不代表官方受理資格。
    </p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 disabled:opacity-50"
        :class="buttonClass"
        :disabled="settling"
        aria-label="同步賽果並結算"
        @click="handleSettle"
      >
        同步賽果並結算
      </button>
      <span class="text-sm text-stone-600" aria-live="polite">{{ settleMessage }}</span>
    </div>
    <p v-if="errorMessage" class="mt-3 text-sm text-rose-700" role="alert">{{ errorMessage }}</p>
    <p v-if="bankroll && ledgerKind === 'sim'" class="mt-3 text-sm text-stone-600">模擬本金 {{ bankroll.balance }}</p>
    <div class="mt-4 flex flex-wrap gap-3 text-sm">
      <label>帳本 <select v-model="ledgerKind" class="ml-2 rounded-lg border border-stone-300 px-3 py-2" aria-label="績效帳本"><option value="sim">模擬</option><option value="real">實注標記</option></select></label>
      <label>策略 <select v-model="strategy" class="ml-2 rounded-lg border border-stone-300 px-3 py-2" aria-label="績效策略"><option value="">全部</option><option value="research">研究</option><option value="conservative">保守模擬</option></select></label>
    </div>
    <PerformancePanel v-if="ticketsData?.stats" :stats="ticketsData.stats" />

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="過關單">
      <h2 class="text-base font-semibold">含本頁球種的投注單（{{ tickets.length }}）</h2>
      <p v-if="tickets.length === 0" class="mt-4 text-sm text-stone-500">還沒有未封存的投注單。在計算頁按「加入投注單」後送出。</p>
      <ul v-else class="mt-3 divide-y divide-stone-100">
        <li v-for="ticket in tickets" :key="ticket.id" class="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
          <div class="min-w-0">
            <p class="text-xs text-stone-500">
              {{ ticket.ledgerKind === 'sim' ? '模擬' : '實注' }}
              · {{ ticket.kind === 'single' ? '單注' : '過關' }} · {{ ticket.strategy === 'conservative' ? '保守' : '研究' }}
              · {{ formatTaipeiTime(ticket.placedAt) }}
              <span class="ml-1 rounded-full px-2 py-0.5 text-xs" :class="statusClass[ticket.status]">{{ statusLabel[ticket.status] }}</span>
            </p>
            <p class="font-medium">綜合賠率 {{ ticket.combinedOdds }} × {{ ticket.stake }}{{ ticket.payout !== null ? `，派彩 ${ticket.payout}` : '' }}</p>
            <ul class="mt-1 space-y-1 text-xs text-stone-600">
              <li v-for="leg in ticket.legs" :key="leg.id">
                {{ sportLabel[leg.sport] }} {{ leg.awayName }} 對 {{ leg.homeName }} · {{ marketLabelFor(leg.sport, leg.market) }} {{ leg.outcomeLabel }} @ {{ leg.odds }}
                （{{ statusLabel[leg.status] }}）
              </li>
            </ul>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-rose-200 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
            :aria-label="`封存這張${ticket.ledgerKind === 'sim' ? '模擬' : '實注'}投注單`"
            @click="handleDeleteTicket(ticket)"
          >
            封存
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { marketLabelFor, type BetStatus, type Sport, type TicketRecord, type TicketsResponse } from '~~/shared/types'
import { sportLabel } from '~~/shared/sports'

const props = defineProps<{
  sport: Sport
}>()
const ledgerKind = ref<'sim' | 'real'>('sim')
const strategy = ref('')

const buttonClass = computed(() => {
  if (props.sport === 'volleyball') return 'bg-orange-700 focus-visible:ring-orange-700'
  if (props.sport === 'tennis') return 'bg-lime-800 focus-visible:ring-lime-800'
  return 'bg-stone-900 focus-visible:ring-stone-900'
})

const statusLabel: Record<BetStatus, string> = { open: '未結算', won: '贏', lost: '輸', void: '作廢' }

const statusClass: Record<BetStatus, string> = {
  open: 'bg-stone-100 text-stone-700',
  won: 'bg-emerald-100 text-emerald-900',
  lost: 'bg-rose-100 text-rose-800',
  void: 'bg-amber-100 text-amber-900',
}

const { data: ticketsData, refresh: refreshTickets } = await useFetch<TicketsResponse>('/api/tickets', {
  key: `tickets-${props.sport}`,
  query: { sport: props.sport, ledger: ledgerKind, strategy },
})
const tickets = computed(() => ticketsData.value?.tickets ?? [])
const bankroll = computed(() => ticketsData.value?.bankroll ?? null)
const errorMessage = ref('')
const settleMessage = ref('')
const settling = ref(false)

const handleDeleteTicket = async (ticket: TicketRecord) => {
  const ledgerLabel = ticket.ledgerKind === 'sim' ? '模擬' : '實注'
  if (!window.confirm(`封存這張${ledgerLabel}投注單？紀錄、後續結算與損益仍會保留，本金不退回。`)) return
  errorMessage.value = ''
  try {
    await $fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' })
    await refreshTickets()
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
    await refreshTickets()
  } catch (error) {
    settleMessage.value = ''
    errorMessage.value = apiErrorMessage(error, '同步失敗')
  } finally {
    settling.value = false
  }
}
</script>
