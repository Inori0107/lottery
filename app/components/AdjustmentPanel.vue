<template>
  <section class="rounded-2xl border border-stone-200 bg-white p-4" aria-label="質化調整紀錄">
    <h2 class="text-base font-semibold">質化調整紀錄</h2>
    <p class="mt-1 text-sm text-stone-600">只記在這裡，不會覆寫模型原始機率。決策與期望值仍用模型。</p>
    <form class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="handleSubmit">
      <label class="block text-xs text-stone-500" for="adj-market">
        玩法
        <select id="adj-market" v-model="market" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option v-for="item in markets" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500" for="adj-outcome">
        選項
        <select id="adj-outcome" v-model="outcomeKey" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option v-for="item in outcomes" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500" for="adj-delta">
        調整（百分點）
        <input id="adj-delta" v-model="deltaText" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" step="0.5" placeholder="+3">
      </label>
      <label class="block text-xs text-stone-500" for="adj-reason">
        原因
        <select id="adj-reason" v-model="reasonCategory" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option v-for="item in ADJUSTMENT_CATEGORIES" :key="item" :value="item">{{ adjustmentCategoryLabel[item] }}</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500 sm:col-span-2 lg:col-span-1" for="adj-note">
        說明
        <input id="adj-note" v-model="note" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="text" maxlength="500">
      </label>
      <div class="sm:col-span-2 lg:col-span-5">
        <button
          type="submit"
          class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50"
          :disabled="saving"
        >
          記錄調整
        </button>
        <p v-if="errorMessage" class="mt-2 text-sm text-rose-700" role="alert">{{ errorMessage }}</p>
      </div>
    </form>
    <ul v-if="items.length > 0" class="mt-4 divide-y divide-stone-100 text-sm">
      <li v-for="item in items" :key="item.id" class="py-2">
        <p class="font-medium">
          {{ marketLabelFor(sport, item.market as BetMarket) }} {{ item.outcomeKey }}
          {{ item.deltaPct > 0 ? `+${item.deltaPct}` : item.deltaPct }}%
          · {{ adjustmentCategoryLabel[item.reasonCategory] }}
        </p>
        <p class="text-xs text-stone-500">
          {{ formatTaipeiTime(item.createdAt) }}
          <span v-if="item.note"> · {{ item.note }}</span>
        </p>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import {
  ADJUSTMENT_CATEGORIES,
  adjustmentCategoryLabel,
  type AdjustmentCategory,
  type ProbabilityAdjustment,
} from '~~/shared/adjustments'
import { marketLabelFor, type BetMarket, type QuoteResponse, type Sport } from '~~/shared/types'

const props = defineProps<{
  fixtureId: number
  sport: Sport
  quote: QuoteResponse
}>()

const emit = defineEmits<{
  saved: []
}>()

const market = ref<BetMarket>('match')
const outcomeKey = ref('away')
const deltaText = ref('3')
const reasonCategory = ref<AdjustmentCategory>('other')
const note = ref('')
const saving = ref(false)
const errorMessage = ref('')
const items = ref<ProbabilityAdjustment[]>([])

const markets = computed(() => {
  const quote = props.quote
  const listed: Array<{ value: BetMarket, label: string }> = [
    { value: 'match', label: marketLabelFor(props.sport, 'match') },
    { value: 'set1', label: marketLabelFor(props.sport, 'set1') },
  ]
  if (quote.totalPoints) listed.push({ value: 'totals', label: marketLabelFor(props.sport, 'totals') })
  if (quote.pointsHandicap) listed.push({ value: 'handicap', label: marketLabelFor(props.sport, 'handicap') })
  if (quote.correctScore) listed.push({ value: 'correctScore', label: marketLabelFor(props.sport, 'correctScore') })
  if (quote.setHandicap) listed.push({ value: 'setHandicap', label: marketLabelFor(props.sport, 'setHandicap') })
  if (quote.set1TotalPoints) listed.push({ value: 'set1Totals', label: marketLabelFor(props.sport, 'set1Totals') })
  if (quote.set1PointsHandicap) listed.push({ value: 'set1Handicap', label: marketLabelFor(props.sport, 'set1Handicap') })
  return listed
})

const outcomes = computed(() => {
  if (market.value === 'match' || market.value === 'set1') {
    return [
      { value: 'away', label: props.quote.away.name },
      { value: 'home', label: props.quote.home.name },
    ]
  }
  const quote = {
    totals: props.quote.totalPoints,
    handicap: props.quote.pointsHandicap,
    correctScore: props.quote.correctScore,
    setHandicap: props.quote.setHandicap,
    set1Totals: props.quote.set1TotalPoints,
    set1Handicap: props.quote.set1PointsHandicap,
  }[market.value]
  return (quote?.outcomes ?? []).map(outcome => ({ value: outcome.key, label: outcome.label }))
})

const loadItems = async () => {
  items.value = await $fetch<ProbabilityAdjustment[]>(`/api/adjustments?fixtureId=${props.fixtureId}`)
}

const handleSubmit = async () => {
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/adjustments', {
      method: 'POST',
      body: {
        fixtureId: props.fixtureId,
        market: market.value,
        outcomeKey: outcomeKey.value,
        deltaPct: Number(deltaText.value),
        reasonCategory: reasonCategory.value,
        note: note.value,
      },
    })
    note.value = ''
    await loadItems()
    emit('saved')
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '無法記錄調整')
  } finally {
    saving.value = false
  }
}

watch(market, () => {
  outcomeKey.value = outcomes.value[0]?.value ?? 'away'
})

watch(() => props.fixtureId, () => {
  void loadItems()
}, { immediate: true })
</script>
