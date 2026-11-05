<template>
  <div>
    <h1 class="text-2xl font-semibold">過關模擬</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      警示不是硬擋。資料不足的腳仍可過關，機率改用去水盤口並標成沒有模型機率。
    </p>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="警示門檻">
      <h2 class="text-base font-semibold">警示門檻（可改）</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="block text-xs text-stone-500" for="max-fragile">
          延長局／deuce 敏感腳上限
          <input id="max-fragile" v-model.number="config.maxFragileLegs" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0" step="1">
        </label>
        <label class="block text-xs text-stone-500" for="max-round">
          同一賽事輪次腳數上限
          <input id="max-round" v-model.number="config.maxSameCompetitionRoundLegs" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0" step="1">
        </label>
        <label class="block text-xs text-stone-500" for="short-odds">
          短賠警示（≤）
          <input id="short-odds" v-model.number="config.shortOddsThreshold" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01">
        </label>
        <label class="block text-xs text-stone-500" for="split-at">
          幾腳時建議拆 3 串
          <input id="split-at" v-model.number="config.suggestSplitAtLegs" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="3" step="1">
        </label>
      </div>
    </section>

    <section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="過關腳">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold">已選 {{ legs.length }} 腳</h2>
        <button
          type="button"
          class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
          :disabled="legs.length === 0"
          @click="clearLegs"
        >
          清空
        </button>
      </div>
      <p v-if="legs.length === 0" class="mt-3 text-sm text-stone-500">從計算結果按「加入過關」。資料不足的腳也會進來。</p>
      <ul v-else class="mt-3 divide-y divide-stone-100">
        <li v-for="(leg, index) in legs" :key="`${leg.fixtureId}-${leg.market}-${leg.outcomeKey}`" class="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
          <div class="min-w-0">
            <p class="font-medium">{{ leg.awayName }} 對 {{ leg.homeName }} · {{ marketLabelFor(leg.sport, leg.market) }} {{ leg.outcomeLabel }}</p>
            <p class="text-xs text-stone-500">
              {{ leg.tournament }}{{ leg.round ? `／${leg.round}` : '' }} · 賠率 {{ leg.odds }} ·
              機率 {{ formatPercent(leg.probability) }}（{{ leg.probabilitySource === 'model' ? '模型' : '去水盤口，無模型機率' }}）
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            :aria-label="`移除 ${leg.outcomeLabel}`"
            @click="removeLeg(index)"
          >
            移除
          </button>
        </li>
      </ul>
    </section>

    <section v-if="legs.length > 0" class="mt-6 rounded-2xl border border-stone-200 bg-white p-4" aria-label="過關摘要">
      <h2 class="text-base font-semibold">合賠與期望值</h2>
      <p class="mt-2 text-sm">合賠 {{ evaluation.combinedOdds.toFixed(3) }}，合機率 {{ formatPercent(evaluation.combinedProbability) }}，EV {{ formatEv(evaluation.ev) }}</p>
      <ul v-if="evaluation.warnings.length > 0" class="mt-3 space-y-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950" aria-label="過關警示">
        <li v-for="warning in evaluation.warnings" :key="warning.code + warning.message">{{ warning.message }}</li>
      </ul>
      <p v-else class="mt-3 text-sm text-stone-500">目前沒有警示。</p>
      <div v-if="evaluation.splitHint" class="mt-4">
        <p class="text-sm font-medium">{{ evaluation.splitHint }}</p>
        <ul class="mt-2 space-y-1 text-xs text-stone-600">
          <li v-for="(split, index) in evaluation.splits" :key="index">
            {{ split.labels.join(' + ') }} · 合賠 {{ split.combinedOdds.toFixed(3) }} · EV {{ formatEv(split.ev) }} · 金額 {{ split.stakeCost }}
          </li>
        </ul>
      </div>
      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="handlePlace">
        <label class="block text-xs text-stone-500" for="parlay-stake">
          標記已下（金額）
          <input id="parlay-stake" v-model="stakeText" class="mt-1 w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1" step="1" required>
        </label>
        <button
          type="submit"
          class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50"
          :disabled="legs.length < 2 || placing"
        >
          {{ placing ? '記錄中…' : '記錄這張過關' }}
        </button>
        <p v-if="placeMessage" class="text-sm text-emerald-800">{{ placeMessage }}</p>
        <p v-if="placeError" class="text-sm text-rose-700" role="alert">{{ placeError }}</p>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { marketLabelFor } from '~~/shared/types'

const { legs, config, evaluation, removeLeg, clearLegs } = useParlaySlip()
const stakeText = ref('100')
const placing = ref(false)
const placeMessage = ref('')
const placeError = ref('')

const formatEv = (value: number | null) => {
  if (value === null) return '—'
  const text = value.toFixed(3)
  return value > 0 ? `+${text}` : text
}

const handlePlace = async () => {
  placing.value = true
  placeError.value = ''
  placeMessage.value = ''
  try {
    await $fetch('/api/tickets', {
      method: 'POST',
      body: { legs: legs.value, stake: Number(stakeText.value), ledgerKind: 'sim' },
    })
    placeMessage.value = '已記錄到投注單。警示不會擋下單。'
    clearLegs()
  } catch (error) {
    placeError.value = apiErrorMessage(error, '記錄失敗')
  } finally {
    placing.value = false
  }
}
</script>
