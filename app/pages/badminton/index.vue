<template>
  <div>
    <h1 class="text-2xl font-semibold">依投注標的計算</h1>
    <p class="mt-2 text-sm leading-6 text-stone-600">
      帶入運彩賽事後，依可售玩法顯示賠率；同類多條盤口可切換。也可手動選擇選手與輸入賠率。
    </p>
    <p
      v-if="status && !status.ready"
      class="mt-4 rounded-xl bg-amber-50 p-4 text-sm"
    >
      尚未完成回測，請先執行 npm run update:data。
    </p>
    <ul
      v-if="status?.notes?.length"
      class="mt-4 space-y-1 text-xs text-stone-500"
    >
      <li v-for="note in status.notes" :key="note">{{ note }}</li>
    </ul>
    <div
      class="mt-6 flex gap-2 border-b border-stone-200"
      role="tablist"
      aria-label="計算步驟"
    >
      <button
        v-for="(tab, i) in tabs"
        :id="`quote-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        class="border-b-2 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-40"
        :class="
          activeTab === tab.id
            ? 'border-emerald-800 text-emerald-900'
            : 'border-transparent text-stone-500'
        "
        :aria-selected="activeTab === tab.id"
        :aria-controls="`quote-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :disabled="tab.id === 'result' && !result"
        @click="activeTab = tab.id"
        @keydown="moveTab($event, i)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      v-show="activeTab === 'fixtures'"
      id="quote-panel-fixtures"
      class="mt-4"
      role="tabpanel"
      aria-labelledby="quote-tab-fixtures"
    >
      <FixtureList
        :active-id="activeFixture?.sportradarId ?? null"
        @select="selectFixture"
        @updated="fixturesUpdated"
      />
    </div>
    <p
      v-if="stale"
      class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"
      role="status"
    >
      所選場次的賠率或狀態已變動，原計算已失效。<button
        type="button"
        class="ml-2 font-medium underline"
        @click="applyLatest"
      >
        帶入最新賠率並重算
      </button>
    </p>
    <form
      v-show="activeTab === 'form'"
      id="quote-panel-form"
      class="mt-4 space-y-5 rounded-2xl border border-stone-200 bg-white p-4"
      role="tabpanel"
      aria-labelledby="quote-tab-form"
      @submit.prevent="submit"
    >
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-sm"
          >項目<select
            v-model="discipline"
            class="ml-2 rounded-lg border border-stone-300 p-2"
            aria-label="羽球項目"
            @change="manualMode"
          >
            <option value="MS">男單</option>
            <option value="WS">女單</option>
          </select></label
        >
        <button
          v-if="activeFixture"
          type="button"
          class="text-sm underline"
          @click="manualMode"
        >
          改為手動輸入
        </button>
        <span v-if="activeFixture" class="text-xs text-stone-500"
          >賠率時間 {{ formatTaipeiTime(activeFixture.oddsCapturedAt) }}</span
        >
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <PlayerField
          v-model="away"
          label="客隊"
          :discipline="discipline"
        /><PlayerField v-model="home" label="主隊" :discipline="discipline" />
      </div>
      <BadmintonMarketFields
        v-model="inputs"
        :markets="activeFixture?.markets"
        :errors="marketErrors"
      />
      <ul
        v-if="unavailableMarkets.length"
        class="space-y-1 rounded-xl bg-stone-50 p-3 text-xs text-stone-600"
        aria-label="未提供計算的市場"
      >
        <li v-for="market in unavailableMarkets" :key="market.id">
          {{ market.name }}：{{ market.reason ?? '目前無法計算' }}
        </li>
      </ul>
      <p
        v-if="activeFixture && !activeFixture.markets"
        class="text-xs text-amber-900"
      >
        這是舊版匯入資料；請重新同步運彩，以取得可售狀態與完整盤口。
      </p>
      <button
        type="submit"
        class="rounded-lg bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-40"
        :disabled="loading || stale"
      >
        {{ loading ? '計算中…' : '計算' }}
      </button>
      <p v-if="errorMessage" class="text-sm text-rose-700" role="alert">
        {{ errorMessage }}
      </p>
    </form>
    <div
      v-if="result"
      v-show="activeTab === 'result'"
      id="quote-panel-result"
      class="mt-4 space-y-4"
      role="tabpanel"
      aria-labelledby="quote-tab-result"
      aria-live="polite"
    >
      <div
        class="rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600"
      >
        <p class="text-base font-semibold text-stone-900">
          {{ result.away.name }} 對 {{ result.home.name }} ·
          {{ disciplineLabel[result.discipline] }}
        </p>
        <p>資料截至 {{ result.dataThrough }}。報價日 {{ result.asOf }}。</p>
        <p>
          模型 {{ result.modelVersion }}。賠率時間
          {{ formatTaipeiTime(activeFixture?.oddsCapturedAt ?? null) }}。
        </p>
        <p>
          客隊最後出賽 {{ result.away.lastPlayedOn ?? '—' }}，{{
            result.away.matchCount
          }}
          場；主隊 {{ result.home.lastPlayedOn ?? '—' }}，{{
            result.home.matchCount
          }}
          場。
        </p>
        <p class="break-all text-xs text-stone-500">
          來源 {{ result.sourceUrl }}
        </p>
        <button
          type="button"
          class="mt-2 underline"
          @click="activeTab = 'form'"
        >
          修改賠率</button
        ><button
          type="button"
          class="ml-4 underline"
          @click="activeTab = 'fixtures'"
        >
          選其他對局
        </button>
      </div>
      <ul
        v-if="result.warnings.length || Object.values(marketErrors).length"
        class="space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
      >
        <li
          v-for="warning in [
            ...result.warnings,
            ...Object.values(marketErrors),
          ]"
          :key="warning"
        >
          {{ warning }}
        </li>
      </ul>
      <p
        v-if="savedBetMessage || slipMessage"
        class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"
        role="status"
      >
        {{ savedBetMessage || slipMessage }}
        <NuxtLink to="/badminton/bets" class="underline">看投注紀錄</NuxtLink>
      </p>
      <div class="grid gap-4 md:grid-cols-2">
        <MarketCard
          v-for="card in winnerCards"
          :key="card.kind"
          :title="marketLabelFor('badminton', card.kind)"
          :away-name="result.away.name"
          :home-name="result.home.name"
          :quote="card.quote"
          @record="(side) => handleRecordWinner(card.kind, side)"
          @slip="(side) => handleSlipWinner(card.kind, side)"
        />
        <OutcomeMarketCard
          v-for="card in outcomeCards"
          :key="card.kind"
          :title="marketLabelFor('badminton', card.kind)"
          :quote="card.quote"
          @record="(outcome) => handleRecordOutcome(card.kind, outcome)"
          @slip="(outcome) => handleSlipOutcome(card.kind, outcome)"
        />
      </div>
      <p class="text-xs text-stone-500">
        候選是研究結果，並非投注指示。沒有獨立校準的第一局分數玩法維持觀望。
      </p>
    </div>
    <BetDialog
      :draft="betDraft"
      @close="handleCloseBetDialog"
      @saved="handleBetSaved"
    />
  </div>
</template>
<script setup lang="ts">
import type {
  BetMarket,
  FixtureSummary,
  MultiMarketQuote,
  PlayerOption,
  QuoteResponse,
  StatusResponse,
} from '~~/shared/types'
import { marketLabelFor } from '~~/shared/types'
import {
  buildBadmintonOdds,
  inputsForFixture,
  sourcesForInputs,
  sameFixtureVersion,
  type MarketInput,
} from '~/utils/badmintonMarkets'
type Tab = 'fixtures' | 'form' | 'result'
useHead({ title: '羽球對局估計' })
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'fixtures', label: '今日對局' },
  { id: 'form', label: '選手與賠率' },
  { id: 'result', label: '計算結果' },
]
const { data: status } = await useAsyncData('model-status', () =>
  $fetch<StatusResponse>('/api/status'),
)
const discipline = ref<'MS' | 'WS'>('MS')
const away = ref<PlayerOption | null>(null)
const home = ref<PlayerOption | null>(null)
const inputs = ref<MarketInput[]>(inputsForFixture())
const activeFixture = ref<FixtureSummary | null>(null)
const latestFixture = ref<FixtureSummary | null>(null)
const activeTab = ref<Tab>('fixtures')
const result = ref<QuoteResponse | null>(null)
const stale = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const marketErrors = ref<Partial<Record<BetMarket, string>>>({})
let requestVersion = 0
const {
  betDraft,
  savedBetMessage,
  slipMessage,
  handleRecordWinner,
  handleSlipWinner,
  handleRecordOutcome,
  handleSlipOutcome,
  handleCloseBetDialog,
  handleBetSaved,
} = useQuoteBetActions(result, activeFixture)
const unavailableMarkets = computed(
  () =>
    activeFixture.value?.markets?.filter((m) => m.status !== 'available') ?? [],
)
const winnerCards = computed(() =>
  result.value
    ? [
        { kind: 'match' as const, quote: result.value.matchWinner },
        { kind: 'set1' as const, quote: result.value.set1Winner },
      ].filter(
        (card) =>
          !activeFixture.value ||
          inputs.value.some((row) => row.kind === card.kind),
      )
    : [],
)
const outcomeCards = computed(() => {
  if (!result.value) return []
  const q = result.value
  const cards: Array<{
    kind: Exclude<BetMarket, 'match' | 'set1'>
    quote: MultiMarketQuote | null
  }> = [
    { kind: 'totals', quote: q.totalPoints },
    { kind: 'handicap', quote: q.pointsHandicap },
    { kind: 'set1Totals', quote: q.set1TotalPoints },
    { kind: 'set1Handicap', quote: q.set1PointsHandicap },
    { kind: 'setCount', quote: q.setCount },
    { kind: 'correctScore', quote: q.correctScore },
  ]
  return cards.filter(
    (card): card is typeof card & { quote: MultiMarketQuote } =>
      card.quote !== null,
  )
})
const invalidate = () => {
  requestVersion++
  loading.value = false
  result.value = null
  betDraft.value = null
  savedBetMessage.value = ''
}
watch([away, home, inputs], invalidate, { deep: true, flush: 'sync' })
const manualMode = () => {
  invalidate()
  activeFixture.value = null
  latestFixture.value = null
  stale.value = false
  inputs.value = inputsForFixture()
  marketErrors.value = {}
  errorMessage.value = ''
  activeTab.value = 'form'
}
const fixturesUpdated = (fixtures: FixtureSummary[]) => {
  const current = activeFixture.value
  if (!current) return
  const fresh = fixtures.find((f) => f.sportradarId === current.sportradarId)
  if (!fresh || !sameFixtureVersion(current, fresh)) {
    latestFixture.value = fresh ?? null
    stale.value = true
    invalidate()
    activeTab.value = 'form'
  }
}
const selectFixture = async (
  fixture: FixtureSummary,
  selected: Partial<Record<BetMarket, string>> = {},
) => {
  invalidate()
  activeFixture.value = fixture
  latestFixture.value = fixture
  stale.value = false
  discipline.value = fixture.discipline as 'MS' | 'WS'
  away.value = fixture.away
  home.value = fixture.home
  inputs.value = inputsForFixture(fixture, selected)
  marketErrors.value = {}
  errorMessage.value = ''
  activeTab.value = 'form'
  if (!fixture.away || !fixture.home) {
    errorMessage.value = '賠率已帶入，但選手未對上，請手動選擇後計算'
    return
  }
  await submit()
}
const applyLatest = async () => {
  if (!latestFixture.value) {
    errorMessage.value = '目前清單已無這個場次，請選其他對局'
    return
  }
  const selected = Object.fromEntries(
    inputs.value
      .filter((r) => r.sourceMarketId)
      .map((r) => [r.kind, r.sourceMarketId!]),
  )
  await selectFixture(latestFixture.value, selected)
}
const submit = async () => {
  if (loading.value || stale.value) return
  if (!away.value || !home.value || away.value.id === home.value.id) {
    errorMessage.value = '請選擇兩位不同選手'
    return
  }
  if (activeFixture.value && !inputs.value.length) {
    errorMessage.value = '目前沒有可計算的可售盤口'
    return
  }
  const built = buildBadmintonOdds(inputs.value)
  marketErrors.value = built.errors
  const sources = sourcesForInputs(
    inputs.value,
    activeFixture.value?.oddsCapturedAt ?? null,
    built.errors,
  )
  const version = ++requestVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const quote = await $fetch<QuoteResponse>('/api/quote', {
      method: 'POST',
      body: {
        discipline: discipline.value,
        awayPlayerId: away.value.id,
        homePlayerId: home.value.id,
        ...built.body,
      },
    })
    if (version !== requestVersion || stale.value) return
    quote.marketSources = sources
    result.value = quote
    activeTab.value = 'result'
  } catch (error) {
    if (version === requestVersion)
      errorMessage.value = apiErrorMessage(error, '計算失敗')
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
const moveTab = (event: KeyboardEvent, index: number) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const available = tabs.filter((t) => t.id !== 'result' || result.value),
    i = available.findIndex((t) => t.id === tabs[index]?.id)
  const next =
    available[
      (i + (event.key === 'ArrowRight' ? 1 : -1) + available.length) %
        available.length
    ]!
  activeTab.value = next.id
  document.getElementById(`quote-tab-${next.id}`)?.focus()
}
</script>
