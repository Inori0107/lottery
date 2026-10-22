<template>
  <table class="w-full min-w-144 text-left text-sm">
    <thead class="text-xs text-stone-500">
      <tr>
        <th scope="col" class="py-1 pr-2 font-medium">分類</th>
        <th scope="col" class="py-1 pr-2 font-medium">筆數</th>
        <th scope="col" class="py-1 pr-2 font-medium">勝率</th>
        <th scope="col" class="py-1 pr-2 font-medium">盈虧</th>
        <th scope="col" class="py-1 pr-2 font-medium">ROI</th>
        <th scope="col" class="py-1 pr-2 font-medium">平均期望值</th>
        <th scope="col" class="py-1 font-medium">平均 CLV</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-stone-100">
      <tr v-for="row in rows" :key="row.label">
        <th scope="row" class="py-1.5 pr-2 font-medium">{{ row.label }}</th>
        <td class="py-1.5 pr-2">{{ row.stats.count }}</td>
        <td class="py-1.5 pr-2">{{ formatPercent(row.stats.winRate) }}（{{ row.stats.won }}/{{ row.stats.won + row.stats.lost }}）</td>
        <td class="py-1.5 pr-2" :class="{ 'text-emerald-700': row.stats.profit > 0, 'text-rose-700': row.stats.profit < 0 }">{{ row.stats.profit }}</td>
        <td class="py-1.5 pr-2">{{ formatPercent(row.stats.roi) }}</td>
        <td class="py-1.5 pr-2">{{ formatPercent(row.stats.averageEv) }}</td>
        <td class="py-1.5">{{ formatPercent(row.stats.averageClv) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { BetStats } from '~~/shared/types'

defineProps<{
  rows: Array<{ label: string, stats: BetStats }>
}>()
</script>
