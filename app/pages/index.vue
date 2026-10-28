<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center">
    <h1 class="text-3xl font-bold text-stone-900">選擇運動項目</h1>
    <p class="mt-2 text-center text-stone-600">選擇您要計算投注標的的運動類型</p>

    <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="card in SPORT_CARDS"
        :key="card.sport"
        :to="SPORT_BASE_PATH[card.sport]"
        class="group flex flex-col items-center rounded-2xl border-2 border-stone-200 bg-white p-8 transition-all hover:shadow-lg focus:outline-none focus-visible:ring-4"
        :class="card.accentClass"
        tabindex="0"
        :aria-label="`${sportLabel[card.sport]}投注估計`"
      >
        <div
          class="flex h-24 w-24 items-center justify-center rounded-full text-5xl transition-transform group-hover:scale-110"
          :class="card.iconClass"
        >
          {{ sportIcon[card.sport] }}
        </div>
        <h2 class="mt-4 text-xl font-semibold text-stone-900">{{ sportLabel[card.sport] }}</h2>
        <p class="mt-1 text-center text-sm text-stone-500">{{ card.summary }}</p>
        <ul class="mt-3 space-y-1 text-xs text-stone-400">
          <li v-for="point in card.points" :key="point">• {{ point }}</li>
        </ul>
      </NuxtLink>
    </div>

    <div class="mt-10 rounded-xl bg-stone-50 px-6 py-4 text-center">
      <p class="text-sm text-stone-500">
        機率估計依據歷史賽果與 Elo 模型，僅供研究參考，不是投注指示
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SPORT_BASE_PATH } from '~~/shared/nav'
import { sportIcon, sportLabel, type Sport } from '~~/shared/sports'

type SportCard = {
  sport: Sport
  accentClass: string
  iconClass: string
  summary: string
  points: string[]
}

const SPORT_CARDS: SportCard[] = [
  {
    sport: 'badminton',
    accentClass: 'hover:border-emerald-500 focus-visible:ring-emerald-500',
    iconClass: 'bg-emerald-100',
    summary: '男單、女單投注估計',
    points: ['全場、第一局不讓分', '總分大小、讓分', '正確比數（2:0、2:1⋯）'],
  },
  {
    sport: 'volleyball',
    accentClass: 'hover:border-orange-500 focus-visible:ring-orange-500',
    iconClass: 'bg-orange-100',
    summary: '男排、女排投注估計',
    points: ['全場、第 1 盤不讓分', '總分、第 1 盤大小/讓分', '局數讓分、正確比數'],
  },
  {
    sport: 'tennis',
    accentClass: 'hover:border-lime-600 focus-visible:ring-lime-600',
    iconClass: 'bg-lime-100',
    summary: 'ATP、WTA 單打投注估計',
    points: ['全場、第 1 盤不讓分', '總局數大小／讓分、讓盤', '正確盤數與總盤數'],
  },
]

useHead({ title: '選擇運動 - 投注估計' })
</script>
