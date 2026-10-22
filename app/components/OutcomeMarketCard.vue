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
      <p v-if="quote.summary" class="mt-2 text-sm text-stone-600">{{ quote.summary }}</p>
      <ul class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <li
          v-for="outcome in quote.outcomes"
          :key="outcome.key"
          class="min-w-0 rounded-xl border border-stone-100 bg-stone-50 p-3"
          :aria-label="outcome.label"
        >
          <p class="wrap-break-word font-medium text-stone-700">{{ outcome.label }}</p>
          <dl class="mt-2 grid grid-cols-2 gap-2">
            <div class="min-w-0">
              <dt class="text-stone-500">校準機率</dt>
              <dd class="text-lg font-semibold">{{ formatPercent(outcome.probabilityCalibrated) }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-stone-500">期望值</dt>
              <dd class="text-lg font-semibold" :class="evClass(outcome)">{{ formatEv(outcome.ev) }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-stone-500">盈虧兩平</dt>
              <dd>{{ formatPercent(outcome.implied) }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-stone-500">賠率</dt>
              <dd>{{ outcome.odds ?? '—' }}</dd>
            </div>
            <div class="col-span-2 min-w-0 text-xs leading-5 text-stone-500">
              <dt class="inline">原始機率／去水</dt>
              <dd class="ml-1 inline">{{ formatPercent(outcome.probability) }}／{{ formatPercent(outcome.market) }}</dd>
            </div>
          </dl>
          <button
            v-if="outcome.odds !== null"
            type="button"
            class="mt-3 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            :aria-label="`記錄投注 ${title} ${outcome.label}`"
            @click="handleRecord(outcome)"
          >
            記錄投注
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { MultiMarketQuote, OutcomeQuote } from '~~/shared/types'
import { marketActionBadgeClass as badgeClass, marketActionLabel } from '~~/shared/decision'

const props = defineProps<{
  title: string
  quote: MultiMarketQuote
}>()

const emit = defineEmits<{
  record: [outcome: OutcomeQuote]
}>()

const handleRecord = (outcome: OutcomeQuote) => {
  emit('record', outcome)
}

const formatEv = (value: number | null) => value === null ? '—' : value.toFixed(3)

const evClass = (outcome: OutcomeQuote) => {
  if (outcome.ev === null) return ''
  if (outcome.ev <= 0) return 'text-rose-700'
  const decision = props.quote.decision
  if (decision.action === 'candidate' && decision.outcomeKey === outcome.key) return 'text-emerald-700'
  return 'text-amber-800'
}
</script>
