<template>
  <section class="rounded-2xl border border-stone-200 bg-white p-4" aria-label="今日網球對局">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold">今日網球對局（{{ data?.date ?? '—' }}）</h2>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-lime-700"
          aria-label="重新讀取今日對局"
          @click="handleRefresh"
        >
          重新讀取
        </button>
        <NuxtLink
          to="/tennis/tsl-sync"
          class="rounded-lg bg-lime-800 px-3 py-1.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-800"
        >
          更新運彩賠率
        </NuxtLink>
      </div>
    </div>
    <p class="mt-1 text-xs text-stone-500">
      最後匯入 {{ formatTaipeiTime(data?.lastImportAt ?? null) }}。只列運彩有開盤的 ATP、WTA 單打。
    </p>
    <p v-if="error" class="mt-3 text-sm text-rose-700" role="alert">讀不到今日網球對局：{{ error.message }}</p>
    <p v-else-if="data?.message" class="mt-3 text-sm text-amber-900" role="status">{{ data.message }}</p>
    <p v-else-if="data && data.fixtures.length === 0" class="mt-3 text-sm text-stone-500">今天還沒有匯入的網球對局。</p>

    <ul v-if="data && data.fixtures.length > 0" class="mt-3 divide-y divide-stone-100">
      <li
        v-for="fixture in data.fixtures"
        :key="fixture.sportradarId"
        class="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
        :class="{ 'bg-lime-50': fixture.sportradarId === activeId }"
      >
        <div class="min-w-0">
          <p class="text-xs text-stone-500">
            {{ formatTaipeiTime(fixture.startsAt) }} · {{ disciplineLabel[fixture.discipline] }} · {{ fixture.tournament }}
          </p>
          <p class="wrap-break-word font-medium">
            {{ fixture.awayNameZh || fixture.awayName }}
            <span class="text-stone-400">（客）對</span>
            {{ fixture.homeNameZh || fixture.homeName }}
            <span class="text-stone-400">（主）</span>
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-lime-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-lime-900 focus:outline-none focus:ring-2 focus:ring-lime-700"
          :aria-label="`帶入 ${fixture.awayName} 對 ${fixture.homeName} 的對局與賠率`"
          @click="emit('select', fixture)"
        >
          帶入並計算
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { FixtureSummary, FixturesResponse } from '~~/shared/types'
import { disciplineLabel } from '~~/shared/sports'

defineProps<{
  activeId: number | null
}>()

const emit = defineEmits<{
  select: [fixture: FixtureSummary]
}>()

const { data, error, refresh } = await useFetch<FixturesResponse>('/api/tennis/fixtures', { key: 'tennis-fixtures' })

const handleRefresh = () => {
  void refresh()
}
</script>
