<template>
  <section class="rounded-2xl border border-stone-200 bg-white p-4" aria-label="今日對局">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold">今日對局（{{ data?.date ?? '—' }}）</h2>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          aria-label="重新讀取今日對局"
          @click="handleRefresh"
        >
          重新讀取
        </button>
        <NuxtLink
          to="/tsl-sync"
          class="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
        >
          更新運彩賠率
        </NuxtLink>
      </div>
    </div>
    <p class="mt-1 text-xs text-stone-500">
      最後匯入 {{ formatTaipeiTime(data?.lastImportAt ?? null) }}。賠率由運彩頁的書籤小工具送進來，只列運彩有開盤的男單、女單。
    </p>
    <p v-if="isImportStale" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      距上次匯入已超過 {{ STALE_MINUTES }} 分鐘，賠率可能已變動。
    </p>
    <p v-if="error" class="mt-3 text-sm text-rose-700" role="alert">讀不到今日對局：{{ error.message }}</p>
    <p v-else-if="data && data.fixtures.length === 0" class="mt-3 text-sm text-stone-500">今天還沒有匯入的對局。</p>

    <div v-if="tournaments.length > 1" class="mt-3 flex flex-wrap gap-2" role="group" aria-label="依賽事篩選">
      <button
        v-for="option in tournamentOptions"
        :key="option.value"
        type="button"
        class="rounded-full border px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        :class="{
          'border-stone-900 bg-stone-900 text-white': tournamentFilter === option.value,
          'border-stone-300 text-stone-700 hover:bg-stone-50': tournamentFilter !== option.value,
        }"
        :aria-pressed="tournamentFilter === option.value"
        @click="handleFilterTournament(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <ul v-if="filteredFixtures.length > 0" class="mt-3 divide-y divide-stone-100">
      <li
        v-for="fixture in filteredFixtures"
        :key="fixture.sportradarId"
        class="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
        :class="{ 'bg-emerald-50': fixture.sportradarId === activeId }"
      >
        <div class="min-w-0">
          <p class="text-xs text-stone-500">
            {{ formatTaipeiTime(fixture.startsAt) }} · {{ disciplineLabel[fixture.discipline] }} · {{ fixture.tournament }}
            <span class="ml-1 rounded-full px-2 py-0.5" :class="statusClass[fixture.status]">{{ statusLabel[fixture.status] }}</span>
          </p>
          <p class="wrap-break-word font-medium">
            {{ fixture.awayNameZh || fixture.awayName }}
            <span class="text-stone-400">（客）對</span>
            {{ fixture.homeNameZh || fixture.homeName }}
            <span class="text-stone-400">（主）</span>
          </p>
          <p class="wrap-break-word text-xs text-stone-500">
            {{ fixture.awayName }} 對 {{ fixture.homeName }}
            <span v-if="fixture.score" class="ml-1 font-medium text-stone-700">{{ fixture.score }}</span>
          </p>
          <p v-if="!fixture.away || !fixture.home" class="text-xs text-amber-800">
            {{ unlinkedText(fixture) }}對不上資料庫選手，帶入後請手動選擇。
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          :aria-label="`帶入 ${fixture.awayName} 對 ${fixture.homeName} 的對局與賠率`"
          @click="handleSelect(fixture)"
        >
          帶入並計算
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { FixtureStatus, FixtureSummary, FixturesResponse } from '~~/shared/types'

defineProps<{
  activeId: number | null
}>()

const emit = defineEmits<{
  select: [fixture: FixtureSummary]
}>()

const STALE_MINUTES = 30

const statusLabel: Record<FixtureStatus, string> = {
  pre: '未開賽',
  live: '進行中',
  ended: '完賽',
  void: '取消或棄權',
}

const statusClass: Record<FixtureStatus, string> = {
  pre: 'bg-stone-100 text-stone-700',
  live: 'bg-rose-100 text-rose-800',
  ended: 'bg-emerald-100 text-emerald-900',
  void: 'bg-amber-100 text-amber-900',
}

const { data, error, refresh } = await useFetch<FixturesResponse>('/api/fixtures', { key: 'today-fixtures' })

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
let importChannel: BroadcastChannel | undefined
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
  importChannel = new BroadcastChannel(TSL_IMPORT_CHANNEL)
  importChannel.onmessage = () => {
    void refresh()
  }
})
onBeforeUnmount(() => {
  clearInterval(clock)
  importChannel?.close()
})

const isImportStale = computed(() => {
  const lastImportAt = data.value?.lastImportAt
  if (!lastImportAt || (data.value?.fixtures.length ?? 0) === 0) return false
  return now.value - new Date(lastImportAt).getTime() > STALE_MINUTES * 60_000
})

const tournamentFilter = ref('')

const tournaments = computed(() => [...new Set((data.value?.fixtures ?? []).map(fixture => fixture.tournament))])

const tournamentOptions = computed(() => [
  { value: '', label: `全部（${data.value?.fixtures.length ?? 0}）` },
  ...tournaments.value.map(tournament => ({
    value: tournament,
    label: `${tournament}（${(data.value?.fixtures ?? []).filter(fixture => fixture.tournament === tournament).length}）`,
  })),
])

const filteredFixtures = computed(() => (data.value?.fixtures ?? []).filter(fixture =>
  !tournamentFilter.value || fixture.tournament === tournamentFilter.value))

const handleFilterTournament = (tournament: string) => {
  tournamentFilter.value = tournament
}

const unlinkedText = (fixture: FixtureSummary) =>
  [!fixture.away && fixture.awayName, !fixture.home && fixture.homeName].filter(Boolean).join('、')

const handleRefresh = () => {
  void refresh()
}

const handleSelect = (fixture: FixtureSummary) => {
  emit('select', fixture)
}
</script>
