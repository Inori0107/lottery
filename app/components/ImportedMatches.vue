<template>
  <div>
    <h1 class="text-2xl font-semibold">已匯入賽事</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      這裡是 {{ sportLabel[sport] }}歷史賽果，用來核對資料。計算請回計算頁選擇對局與賠率。
    </p>

    <form class="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="handleSearch">
      <label class="min-w-0 text-sm">
        項目
        <select v-model="discipline" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" aria-label="項目">
          <option value="">全部</option>
          <option v-for="item in disciplines" :key="item" :value="item">{{ disciplineLabel[item] }}</option>
        </select>
      </label>
      <label class="min-w-0 text-sm">
        {{ sport === 'volleyball' ? '球隊' : '選手' }}
        <input v-model="player" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2" type="search" :aria-label="sport === 'volleyball' ? '球隊名稱' : '選手姓名'" :placeholder="sport === 'volleyball' ? '隊名' : '英文姓名'">
      </label>
      <label class="min-w-0 text-sm">
        開始日期
        <input v-model="from" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2" type="date" aria-label="開始日期">
      </label>
      <label class="min-w-0 text-sm">
        結束日期
        <input v-model="to" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2" type="date" aria-label="結束日期">
      </label>
      <button type="submit" class="w-fit rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 sm:col-span-2 lg:col-span-4" :class="buttonClass">查詢</button>
    </form>

    <p v-if="errorMessage" class="mt-4 text-sm text-rose-700" role="alert">{{ errorMessage }}</p>
    <p v-else-if="payload" class="mt-4 text-sm text-stone-500">共 {{ payload.total }} 場</p>

    <p v-if="payload && payload.matches.length === 0" class="mt-3 rounded-2xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">這個條件沒有比賽</p>

    <ul v-if="payload && payload.matches.length > 0" class="mt-3 space-y-3 lg:hidden">
      <li v-for="match in payload.matches" :key="match.id" class="rounded-2xl border border-stone-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm text-stone-500">{{ match.playedOn }} · {{ disciplineLabel[match.discipline] }}</p>
          <p class="shrink-0 text-sm font-medium">{{ match.score || '—' }}</p>
        </div>
        <p class="mt-1 font-medium wrap-break-word">{{ match.eventName }}</p>
        <p class="text-xs text-stone-500">{{ match.tier }} · {{ match.round }}</p>
        <p class="mt-2 text-sm wrap-break-word">
          <span :class="{ 'font-semibold': match.sideAWon === true }">{{ match.sideAName }}</span>
          <span class="text-stone-400"> 對 </span>
          <span :class="{ 'font-semibold': match.sideAWon === false }">{{ match.sideBName }}</span>
        </p>
      </li>
    </ul>

    <div v-if="payload && payload.matches.length > 0" class="mt-3 hidden overflow-x-auto rounded-2xl border border-stone-200 bg-white lg:block">
      <table class="w-full table-fixed text-left text-sm">
        <colgroup>
          <col class="w-28">
          <col class="w-16">
          <col>
          <col class="w-40">
          <col class="w-40">
          <col class="w-36">
        </colgroup>
        <thead class="border-b border-stone-200 text-stone-500">
          <tr>
            <th class="px-3 py-2 font-medium whitespace-nowrap">日期</th>
            <th class="px-3 py-2 font-medium whitespace-nowrap">項目</th>
            <th class="px-3 py-2 font-medium">賽事</th>
            <th class="px-3 py-2 font-medium">{{ sport === 'volleyball' ? '隊伍 A' : '選手 A' }}</th>
            <th class="px-3 py-2 font-medium">{{ sport === 'volleyball' ? '隊伍 B' : '選手 B' }}</th>
            <th class="px-3 py-2 font-medium whitespace-nowrap">比分</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="match in payload.matches" :key="match.id" class="border-b border-stone-100 align-top">
            <td class="px-3 py-2 whitespace-nowrap">{{ match.playedOn }}</td>
            <td class="px-3 py-2 whitespace-nowrap">{{ disciplineLabel[match.discipline] }}</td>
            <td class="px-3 py-2">
              <span class="block wrap-break-word">{{ match.eventName }}</span>
              <span class="block text-xs wrap-break-word text-stone-500">{{ match.tier }} · {{ match.round }}</span>
            </td>
            <td class="px-3 py-2 wrap-break-word" :class="{ 'font-semibold': match.sideAWon === true }">{{ match.sideAName }}</td>
            <td class="px-3 py-2 wrap-break-word" :class="{ 'font-semibold': match.sideAWon === false }">{{ match.sideBName }}</td>
            <td class="px-3 py-2 whitespace-nowrap">{{ match.score || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="payload && payload.total > payload.pageSize" class="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page <= 1" @click="handlePage(page - 1)">上一頁</button>
      <p class="text-sm text-stone-500">第 {{ page }} / {{ pageCount }} 頁</p>
      <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page * payload.pageSize >= payload.total" @click="handlePage(page + 1)">下一頁</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Discipline, Sport } from '~~/shared/types'
import { SPORT_CONFIG, disciplineLabel, sportLabel } from '~~/shared/sports'

const props = defineProps<{
  sport: Sport
}>()

const disciplines = SPORT_CONFIG[props.sport].disciplines
const buttonClass = computed(() => {
  if (props.sport === 'volleyball') return 'bg-orange-700 focus-visible:ring-orange-700'
  if (props.sport === 'tennis') return 'bg-lime-800 focus-visible:ring-lime-800'
  return 'bg-stone-900 focus-visible:ring-stone-900'
})

type MatchList = {
  page: number
  pageSize: number
  total: number
  matches: Array<{
    id: string
    discipline: Discipline
    round: string
    playedOn: string
    eventName: string
    tier: string
    sideAName: string
    sideBName: string
    sideAWon: boolean | null
    score: string
  }>
}

const discipline = ref('')
const player = ref('')
const from = ref('')
const to = ref('')
const page = ref(1)
const payload = ref<MatchList | null>(null)
const errorMessage = ref('')

const pageCount = computed(() => {
  if (!payload.value) return 1
  return Math.max(1, Math.ceil(payload.value.total / payload.value.pageSize))
})

const loadMatches = async () => {
  errorMessage.value = ''
  try {
    payload.value = await $fetch<MatchList>('/api/matches', {
      query: {
        sport: props.sport,
        discipline: discipline.value,
        q: player.value,
        from: from.value,
        to: to.value,
        page: page.value,
      },
    })
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '賽事尚未匯入')
  }
}

const handleSearch = () => {
  page.value = 1
  void loadMatches()
}

const handlePage = (nextPage: number) => {
  page.value = nextPage
  void loadMatches()
}

await loadMatches()
</script>
