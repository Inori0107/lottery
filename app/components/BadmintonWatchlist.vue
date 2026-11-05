<template>
  <section class="mb-5 rounded-2xl border border-stone-200 bg-white p-4" aria-label="高命中觀察清單">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-semibold">高命中觀察</h2>
      <button type="button" class="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-50" :disabled="loading" @click="load">{{ loading ? '計算中…' : '分析今日可售場次' }}</button>
    </div>
    <p class="mt-2 text-sm text-stone-600">列出全場勝率估計 ≥80% 的場次；這是觀察門檻，不代表價格划算或保證獲勝。僅用新鮮賠率，分析會保存當時預測。</p>
    <p v-if="error" class="mt-2 text-sm text-rose-700" role="alert">{{ error }}</p>
    <template v-if="data">
      <p class="mt-3 text-sm text-stone-600" role="status">檢查 {{ data.considered }} 場，{{ data.items.length }} 場達觀察門檻，{{ data.skipped.length }} 場因資料或賠率不足未評估。快照時間 {{ formatTaipeiTime(loadedAt) }}。</p>
      <ul class="mt-3 divide-y divide-stone-100">
        <li v-for="item in data.items" :key="item.fixture.sportradarId" class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div class="min-w-0"><p class="break-words font-medium">{{ item.side === 'away' ? item.fixture.awayName : item.fixture.homeName }} · {{ formatPercent(item.probability) }} · 賠率 {{ item.odds }}</p>
            <p class="mt-1 text-xs text-stone-600">{{ item.fixture.awayName }} 對 {{ item.fixture.homeName }}</p>
            <p class="mt-1 text-xs" :class="item.eligible ? 'text-emerald-800' : 'text-amber-900'">{{ item.eligible ? '通過保守模擬研究門檻' : item.reasons.join('；') }}</p>
          </div>
          <button type="button" class="rounded-lg border border-stone-300 px-3 py-2" @click="emit('select', item.fixture)">查看最新分析</button>
        </li>
      </ul>
      <details v-if="data.skipped.length" class="mt-3 text-sm text-stone-600"><summary>未評估原因</summary><p v-for="item in data.skipped" :key="item.title" class="mt-2">{{ item.title }}：{{ item.reason }}</p></details>
    </template>
  </section>
</template>
<script setup lang="ts">
import type { BadmintonWatchlist, FixtureSummary } from '~~/shared/types'
const emit = defineEmits<{ select: [fixture: FixtureSummary] }>()
const data = ref<BadmintonWatchlist | null>(null), loading = ref(false), error = ref(''), loadedAt = ref<string | null>(null)
const load = async () => {
  loading.value = true; error.value = ''
  try { data.value = await $fetch<BadmintonWatchlist>('/api/badminton/watchlist', { method: 'POST' }); loadedAt.value = new Date().toISOString() }
  catch (e) { error.value = apiErrorMessage(e, '無法讀取觀察清單') }
  finally { loading.value = false }
}
</script>
