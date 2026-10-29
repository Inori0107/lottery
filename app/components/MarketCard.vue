<template>
  <section class="min-w-0 rounded-2xl border border-stone-200 bg-white p-4" :aria-label="title">
    <h2 class="text-base font-semibold">{{ title }}</h2>
    <p v-if="quote.status === 'insufficient'" class="mt-3 text-sm text-amber-800">資料不足：{{ quote.reason }}</p>
    <template v-else>
      <p class="mt-3 text-lg font-medium">較可能勝出：{{ sideName(favourite) }} <span class="tabular-nums">{{ formatPercent(probability(favourite)) }}</span></p>
      <p class="mt-1 text-sm text-stone-600">{{ quote.calibrationApplied ? '已校準模型估計' : '未校準模型估計' }}，仍有 {{ formatPercent(1 - (probability(favourite) ?? 0)) }} 落敗機會。</p>
      <p v-if="showConservative && (probability(favourite) ?? 0) >= HIGH_PROBABILITY_THRESHOLD" class="mt-2 text-sm text-emerald-800">高命中觀察（勝率估計 ≥80%）；價格及可信度仍須另外檢查。</p>
      <p class="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><strong>價格判斷：</strong>{{ marketActionLabel[quote.decision.action] }} · {{ quote.decision.reason }}</p>
      <p v-if="showConservative" class="mt-2 text-sm" :class="eligibility.eligible ? 'text-emerald-800' : 'text-amber-900'">保守模擬：{{ eligibility.eligible ? '通過研究門檻，可在投注單選擇保守模式' : eligibility.reasons.join('；') }}</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div v-for="side in SIDES" :key="side" class="min-w-0 rounded-xl bg-stone-50 p-3">
          <h3 class="break-words font-medium">{{ sideName(side) }}</h3>
          <dl class="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><dt class="text-stone-500">模型勝率</dt><dd class="font-medium">{{ formatPercent(probability(side)) }}</dd></div>
            <div><dt class="text-stone-500">運彩賠率</dt><dd class="font-medium">{{ odds(side) ?? '未提供' }}</dd></div>
            <div><dt class="text-stone-500">打平所需勝率</dt><dd>{{ formatPercent(implied(side)) }}</dd></div>
            <div><dt class="text-stone-500">預估報酬率</dt><dd>{{ formatEvPercent(ev(side)) }}</dd></div>
            <div class="col-span-2"><dt class="text-stone-500">每投 100 元的長期期望損益</dt><dd class="font-medium">{{ formatEvMoney(ev(side)) }}</dd></div>
          </dl>
          <button v-if="odds(side) !== null && canAdd !== false" type="button" class="mt-3 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-700" :aria-label="`加入投注單 ${title} ${sideName(side)}`" @click="emit('slip', side)">加入投注單：{{ sideName(side) }}</button>
        </div>
      </div>
      <details class="mt-4 text-sm text-stone-600">
        <summary class="cursor-pointer">資料可信度與計算詳情</summary>
        <p class="mt-2">{{ quote.validationReady ? '已完成獨立校準與時間外測試；仍未證明優於運彩價格。' : '尚未提供足夠的獨立時間驗證，僅供研究觀察。' }}</p>
        <p v-if="evidence" class="mt-2">較可能勝出方所屬歷史機率組：{{ evidence.n }} 場，實際勝率 {{ formatPercent(evidence.observed) }}，95% 區間 {{ formatPercent(evidence.lower) }}～{{ formatPercent(evidence.upper) }}。這是該組歷史結果，並非這一場的保證。</p>
        <p v-else class="mt-2">尚無可用的同機率組驗證資料。</p>
        <p class="mt-2">原始模型機率：{{ formatPercent(quote.probabilityAway) }}／{{ formatPercent(quote.probabilityHome) }}（客／主）。</p>
        <p class="mt-1">市場去水近似：{{ formatPercent(quote.marketAway) }}／{{ formatPercent(quote.marketHome) }}。這是將兩側賠率正規化的比較值，不是實際勝率。</p>
        <p class="mt-1">預估報酬率為「模型勝率 × 賠率 − 1」，不是本注保證報酬；未計稅費。</p>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import type { MarketQuote, MarketSide } from '~~/shared/types'
import { marketActionLabel } from '~~/shared/decision'
import { HIGH_PROBABILITY_THRESHOLD, conservativeEligibility, formatEvMoney, formatEvPercent } from '~~/shared/strategy'
const props = defineProps<{ title: string; awayName: string; homeName: string; quote: MarketQuote; showConservative?: boolean; canAdd?: boolean }>()
const emit = defineEmits<{ slip: [side: MarketSide] }>()
const SIDES: MarketSide[] = ['away', 'home']
const sideName = (side: MarketSide) => side === 'away' ? props.awayName : props.homeName
const probability = (side: MarketSide) => side === 'away' ? props.quote.probabilityCalibratedAway : props.quote.probabilityCalibratedHome
const implied = (side: MarketSide) => side === 'away' ? props.quote.impliedAway : props.quote.impliedHome
const odds = (side: MarketSide) => { const p = implied(side); return p === null ? null : Math.round(1 / p * 1000) / 1000 }
const ev = (side: MarketSide) => side === 'away' ? props.quote.evAway : props.quote.evHome
const favourite = computed<MarketSide>(() => (probability('away') ?? 0) >= (probability('home') ?? 0) ? 'away' : 'home')
const evidence = computed(() => favourite.value === 'away' ? props.quote.evidenceAway : props.quote.evidenceHome)
const eligibility = computed(() => conservativeEligibility(props.quote, favourite.value))
</script>
