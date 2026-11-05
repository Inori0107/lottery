<template>
  <section class="mt-5 rounded-2xl border border-stone-200 bg-white p-4" aria-label="前瞻模擬績效">
    <h2 class="font-semibold">保存賽前預測的績效</h2>
    <p class="mt-2 text-xs text-stone-600">{{ stats.tracked }} 張有保存預測，{{ stats.settled }} 張已分勝負；{{ stats.legacy }} 張舊紀錄未納入。封存不移除績效，模擬與實注分開計算。</p>
    <dl class="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
      <div><dt class="text-stone-500">已結算命中率</dt><dd class="text-lg font-medium">{{ formatPercent(stats.winRate) }}</dd></div>
      <div><dt class="text-stone-500">已結算淨損益</dt><dd class="text-lg font-medium">{{ stats.profit.toFixed(2) }} 元</dd></div>
      <div><dt class="text-stone-500">投入報酬率 ROI</dt><dd class="text-lg font-medium">{{ formatPercent(stats.roi) }}</dd></div>
      <div><dt class="text-stone-500">已結算損益最大回撤</dt><dd>{{ stats.maxDrawdown.toFixed(2) }} 元</dd></div>
      <div><dt class="text-stone-500">已結算投入</dt><dd>{{ stats.staked.toFixed(2) }} 元</dd></div>
      <div><dt class="text-stone-500">平均 CLV</dt><dd>{{ formatPercent(stats.averageClv) }}</dd></div>
    </dl>
    <p class="mt-3 text-xs text-stone-600">ROI 與命中率排除作廢；回撤只按已結算淨損益計算，不包含未結算曝險。CLV 為下注價相對同線收盤價，缺資料時不補值。</p>
    <details class="mt-4 text-sm text-stone-600">
      <summary>羽球全場：模型與市場比較</summary>
      <p class="mt-2">同場重複投注只取最早一筆已保存預測；以下僅代表已投注的樣本，並非所有賽事。{{ stats.comparison.n }} 場同時有模型與去水市場機率。</p>
      <p class="mt-2">模型 log loss {{ number(stats.comparison.modelLogLoss) }}／市場 {{ number(stats.comparison.marketLogLoss) }}；模型 Brier {{ number(stats.comparison.modelBrier) }}（越低越好）。</p>
      <div class="mt-3 overflow-x-auto"><table class="w-full text-left text-xs"><caption class="mb-2 text-left">模型勝率分組驗證</caption><thead><tr><th class="py-2">機率組</th><th>樣本</th><th>預測均值</th><th>實際命中</th></tr></thead><tbody><tr v-for="bin in stats.calibration" :key="bin.label" class="border-t border-stone-100"><td class="py-2">{{ bin.label }}</td><td>{{ bin.n }}</td><td>{{ formatPercent(bin.predicted) }}</td><td>{{ formatPercent(bin.actual) }}</td></tr></tbody></table></div>
    </details>
  </section>
</template>
<script setup lang="ts">
import type { PerformanceSummary } from '~~/shared/performance'
defineProps<{ stats: PerformanceSummary }>()
const number = (v: number | null) => v === null ? '—' : v.toFixed(4)
</script>
