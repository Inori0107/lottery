<template>
  <section class="min-w-0 rounded-2xl border border-stone-200 bg-white p-4" :aria-label="title">
    <h2 class="text-base font-semibold">{{ title }}</h2>
    <p v-if="quote.status === 'insufficient'" class="mt-3 text-sm text-amber-800">不評估：{{ quote.reason }}</p>
    <template v-else>
      <p
        class="mt-3 inline-flex max-w-full flex-wrap items-center rounded-full px-3 py-1 text-sm font-semibold"
        :class="badgeClass[quote.decision.action]"
        :aria-label="`${marketActionLabel[quote.decision.action]}，${quote.decision.reason}`"
      >
        {{ marketActionLabel[quote.decision.action] }}
        <span class="ml-1 font-medium">{{ quote.decision.reason }}</span>
      </p>
      <dl class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div class="min-w-0">
          <dt class="wrap-break-word text-stone-500">{{ awayName }} 校準機率</dt>
          <dd class="text-lg font-semibold">{{ formatPercent(quote.probabilityCalibratedAway) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="wrap-break-word text-stone-500">{{ homeName }} 校準機率</dt>
          <dd class="text-lg font-semibold">{{ formatPercent(quote.probabilityCalibratedHome) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-stone-500">客隊盈虧兩平</dt>
          <dd>{{ formatPercent(quote.impliedAway) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-stone-500">主隊盈虧兩平</dt>
          <dd>{{ formatPercent(quote.impliedHome) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-stone-500">客隊期望值</dt>
          <dd class="text-lg font-semibold" :class="evClass('away')">{{ formatEv(quote.evAway) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-stone-500">主隊期望值</dt>
          <dd class="text-lg font-semibold" :class="evClass('home')">{{ formatEv(quote.evHome) }}</dd>
        </div>
      </dl>
      <dl class="mt-4 grid grid-cols-1 gap-2 text-xs leading-5 text-stone-500 sm:grid-cols-2">
        <div class="min-w-0">
          <dt>客隊原始機率／去水</dt>
          <dd>{{ formatPercent(quote.probabilityAway) }}／{{ formatPercent(quote.marketAway) }}</dd>
        </div>
        <div class="min-w-0">
          <dt>主隊原始機率／去水</dt>
          <dd>{{ formatPercent(quote.probabilityHome) }}／{{ formatPercent(quote.marketHome) }}</dd>
        </div>
      </dl>
      <div v-if="quote.evAway !== null" class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="side in SIDES"
          :key="side"
          type="button"
          class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          :aria-label="`記錄投注 ${title} ${sideName(side)}`"
          @click="handleRecord(side)"
        >
          記錄投注：{{ sideName(side) }}
        </button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { MarketQuote, MarketSide } from '~~/shared/types'
import { marketActionBadgeClass as badgeClass, marketActionLabel } from '~~/shared/decision'

const props = defineProps<{
  title: string
  awayName: string
  homeName: string
  quote: MarketQuote
}>()

const emit = defineEmits<{
  record: [side: MarketSide]
}>()

const SIDES: MarketSide[] = ['away', 'home']

const sideName = (side: MarketSide) => (side === 'away' ? props.awayName : props.homeName)

const handleRecord = (side: MarketSide) => {
  emit('record', side)
}

const formatEv = (value: number | null) => value === null ? '—' : value.toFixed(3)

const evClass = (side: MarketSide) => {
  const value = side === 'away' ? props.quote.evAway : props.quote.evHome
  if (value === null) return ''
  if (value <= 0) return 'text-rose-700'
  if (props.quote.decision.action === 'candidate' && props.quote.decision.side === side) return 'text-emerald-700'
  return 'text-amber-800'
}
</script>
