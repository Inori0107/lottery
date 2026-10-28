<template>
  <aside
    class="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-end"
    aria-label="投注單"
  >
    <div
      class="pointer-events-auto flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl"
      :class="open ? 'w-[min(24rem,100%)]' : 'w-auto max-w-full'"
    >
      <button
        type="button"
        class="flex w-full shrink-0 items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
        :aria-expanded="open"
        aria-controls="parlay-slip-panel"
        :aria-label="open ? '收合投注單' : `展開投注單，目前 ${legs.length} 腿`"
        @click="handleToggle"
        @keydown.enter.prevent="handleToggle"
      >
        <span class="text-sm font-semibold">投注單（{{ legs.length }}）</span>
        <span class="flex items-center gap-2">
          <span v-if="open" class="text-xs text-stone-500">模擬本金 {{ bankroll?.balance ?? '—' }}</span>
          <span class="text-xs text-stone-400" aria-hidden="true">{{ open ? '▾' : '▴' }}</span>
        </span>
      </button>
      <div v-if="open" id="parlay-slip-panel" class="min-h-0 flex-1 overflow-y-auto border-t border-stone-100 px-4 py-3">
        <p class="text-xs leading-5 text-stone-500">
          一腿為單注；兩腿以上為過關。羽球、排球、網球可混串，同場不可串。過關機率假設各場獨立。
        </p>
        <p v-if="oddsUpdated" class="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900" role="status">賠率已重新同步。各腿仍保留加入時的數值，送出前會由伺服器核對；版本不同時請重算並重新加入。</p>
        <p v-if="legs.length === 0" class="mt-3 text-sm text-stone-500">還沒有投注。在計算結果按「加入投注單」。</p>
        <ul v-else class="mt-3 max-h-56 space-y-2 overflow-auto">
          <li v-for="(leg, index) in legs" :key="`${leg.fixtureId}-${leg.market}-${leg.outcomeKey}`" class="rounded-xl bg-stone-50 px-3 py-2 text-xs">
            <div class="flex items-start justify-between gap-2">
              <p class="min-w-0 wrap-break-word font-medium text-stone-800">
                {{ sportIcon[leg.sport] }} {{ leg.awayName }} 對 {{ leg.homeName }}
              </p>
              <button
                type="button"
                class="shrink-0 text-rose-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
                :aria-label="`移除 ${leg.outcomeLabel}`"
                @click="handleRemove(index)"
              >
                移除
              </button>
            </div>
            <p class="mt-1 text-stone-600">{{ marketLabelFor(leg.sport, leg.market) }}：{{ leg.outcomeLabel }} @ {{ leg.odds }}</p>
          </li>
        </ul>

        <p v-if="parlayQuote" class="mt-3 text-sm text-stone-700">
          綜合賠率 {{ parlayQuote.combinedOdds }}
          <span v-if="parlayQuote.combinedProbability !== null">，綜合機率 {{ formatPercent(parlayQuote.combinedProbability) }}</span>
          <span v-if="parlayQuote.ev !== null">，EV {{ parlayQuote.ev.toFixed(3) }}</span>
        </p>
        <p v-if="quoteReason" class="mt-1 text-xs" :class="parlayQuote ? 'text-stone-500' : 'text-amber-800'">{{ quoteReason }}</p>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="text-xs text-stone-500">
            注碼方式
            <select v-model="stakeMode" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-900" aria-label="注碼方式">
              <option value="flat">固定金額</option>
              <option value="percent">本金 2%</option>
              <option value="kelly">四分之一 Kelly</option>
            </select>
          </label>
          <label class="text-xs text-stone-500">
            金額
            <input v-model="stakeText" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-900" type="number" min="1" step="1" inputmode="numeric" aria-label="投注金額">
          </label>
        </div>
        <label class="mt-2 flex items-center gap-2 text-xs text-stone-600">
          <input v-model="realLedger" type="checkbox" class="rounded border-stone-300">
          記為實注（要再確認一次；預設是模擬）
        </label>
        <p v-if="errorMessage || slipMessage" class="mt-2 text-xs" :class="errorMessage ? 'text-rose-700' : 'text-emerald-800'" role="status">
          {{ errorMessage || slipMessage }}
        </p>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            @click="handleClear"
          >
            清空
          </button>
          <button
            type="button"
            class="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50"
            :disabled="submitting || legs.length === 0"
            @click="handleSubmit"
          >
            {{ realLedger ? '記錄實注' : '模擬送出' }}{{ legs.length === 1 ? '單注' : '過關' }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { BankrollRecord, LedgerKind, TicketRecord } from '~~/shared/types'
import { marketLabelFor } from '~~/shared/types'
import { sportIcon } from '~~/shared/sports'
import { isParlayQuote, quoteParlay, suggestedStake } from '~~/shared/parlay'
import { TSL_IMPORT_CHANNEL } from '~/utils/tslBookmarklet'

const { legs, message: slipMessage, removeLeg, clearLegs } = useParlaySlip()
const open = ref(false)
const stakeMode = ref<'flat' | 'percent' | 'kelly'>('flat')
const stakeText = ref('100')
const realLedger = ref(false)
const errorMessage = ref('')
const submitting = ref(false)
const oddsUpdated = ref(false)
let importChannel: BroadcastChannel | undefined
onMounted(() => {
  importChannel = new BroadcastChannel(TSL_IMPORT_CHANNEL)
  importChannel.onmessage = () => { if (legs.value.length) oddsUpdated.value = true }
})
onBeforeUnmount(() => importChannel?.close())
const { data: bankroll, refresh: refreshBankroll } = await useFetch<BankrollRecord>('/api/bankroll', {
  key: 'sim-bankroll',
  query: { ledger: 'sim' },
})

const quoted = computed(() => {
  if (legs.value.length === 0) return null
  return quoteParlay(legs.value)
})
const parlayQuote = computed(() => quoted.value && isParlayQuote(quoted.value) ? quoted.value : null)
const quoteReason = computed(() => legs.value.length > 1 ? quoted.value?.reason ?? null : null)

watch(() => legs.value.length, (count, previous) => {
  if (count > previous) open.value = true
  if (count === 0) oddsUpdated.value = false
})

watch([parlayQuote, stakeMode, bankroll], () => {
  if (stakeMode.value === 'flat' || !bankroll.value) return
  const current = parlayQuote.value
  if (!current) return
  const suggested = suggestedStake(bankroll.value.balance, current, stakeMode.value)
  if (suggested > 0) stakeText.value = String(suggested)
})

const handleToggle = () => {
  open.value = !open.value
}

const handleRemove = (index: number) => {
  removeLeg(index)
}

const handleClear = () => {
  clearLegs()
  errorMessage.value = ''
}

const handleSubmit = async () => {
  errorMessage.value = ''
  if (legs.value.length === 0) {
    errorMessage.value = '請先加入一筆投注'
    return
  }
  const stake = Number(stakeText.value)
  if (!(stake > 0)) {
    errorMessage.value = '金額要大於 0'
    return
  }
  const ledgerKind: LedgerKind = realLedger.value ? 'real' : 'sim'
  if (ledgerKind === 'real' && !window.confirm('確定記為實注？這不會幫你下運彩，只是帳本標記。')) return
  submitting.value = true
  try {
    await $fetch<TicketRecord>('/api/tickets', {
      method: 'POST',
      body: {
        ledgerKind,
        stake,
        legs: legs.value,
      },
    })
    const kind = legs.value.length === 1 ? '單注' : '過關單'
    clearLegs()
    slipMessage.value = ledgerKind === 'sim' ? `已送出模擬${kind}` : `已記為實注${kind}`
    await refreshBankroll()
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '無法送出投注單')
  } finally {
    submitting.value = false
  }
}
</script>
