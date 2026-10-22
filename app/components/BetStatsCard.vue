<template>
  <section class="min-w-0 rounded-2xl border border-stone-200 bg-white p-4" :aria-label="title">
    <h2 class="text-base font-semibold">{{ title }}</h2>
    <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div class="min-w-0">
        <dt class="text-stone-500">筆數</dt>
        <dd class="text-lg font-semibold">{{ stats.count }}</dd>
        <dd class="text-xs text-stone-500">未結算 {{ stats.open }}、作廢 {{ stats.void }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-stone-500">勝率</dt>
        <dd class="text-lg font-semibold">{{ formatPercent(stats.winRate) }}</dd>
        <dd class="text-xs text-stone-500">{{ stats.won }} 贏 {{ stats.lost }} 輸</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-stone-500">盈虧／ROI</dt>
        <dd class="text-lg font-semibold" :class="{ 'text-emerald-700': stats.profit > 0, 'text-rose-700': stats.profit < 0 }">
          {{ formatSigned(stats.profit) }}
        </dd>
        <dd class="text-xs text-stone-500">投注 {{ stats.staked }}，ROI {{ formatPercent(stats.roi) }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-stone-500">平均 CLV</dt>
        <dd class="text-lg font-semibold" :class="{ 'text-emerald-700': (stats.averageClv ?? 0) > 0, 'text-rose-700': (stats.averageClv ?? 0) < 0 }">
          {{ formatPercent(stats.averageClv) }}
        </dd>
        <dd class="text-xs text-stone-500">CLV 為正 {{ formatPercent(stats.positiveClvRate) }}，平均期望值 {{ formatPercent(stats.averageEv) }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { BetStats } from '~~/shared/types'

defineProps<{
  title: string
  stats: BetStats
}>()
</script>
