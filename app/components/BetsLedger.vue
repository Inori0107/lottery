<template>
  <div>
    <h1 class="text-2xl font-semibold">投注紀錄</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      {{ sportLabel[sport] }}場次對上運彩後，會在 StatsHub 出現完賽比分後自動結算。棄權或取消算作廢、退回本金。含本頁球種任一腿的過關單會列在這裡。
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
    <p v-if="bankroll" class="mt-3 text-sm text-stone-600">模擬本金 {{ bankroll.balance }}</p>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="過關單">
      <h2 class="text-base font-semibold">含本頁球種的過關單（{{ tickets.length }}）</h2>
      <p v-if="tickets.length === 0" class="mt-4 text-sm text-stone-500">還沒有過關單。在計算頁按「加入投注單」，至少兩腿再送出。</p>
      <ul v-else class="mt-3 divide-y divide-stone-100">
        <li v-for="ticket in tickets" :key="ticket.id" class="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
          <div class="min-w-0">
            <p class="text-xs text-stone-500">
              {{ ticket.ledgerKind === 'sim' ? '模擬' : '實注' }}
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
            :aria-label="`刪除這張${ticket.ledgerKind === 'sim' ? '模擬' : '實注'}過關`"
            @click="handleDeleteTicket(ticket)"
          >
            刪除
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
  query: { sport: props.sport },
})
const tickets = computed(() => ticketsData.value?.tickets ?? [])
const bankroll = computed(() => ticketsData.value?.bankroll ?? null)
const errorMessage = ref('')
const settleMessage = ref('')
const settling = ref(false)

const handleDeleteTicket = async (ticket: TicketRecord) => {
  const ledgerLabel = ticket.ledgerKind === 'sim' ? '模擬' : '實注'
  const refundHint = ticket.ledgerKind === 'sim' ? '模擬本金會退回。' : '只會從帳本移除。'
  if (!window.confirm(`確定刪除這張${ledgerLabel}過關？${refundHint}`)) return
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
