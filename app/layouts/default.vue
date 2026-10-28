<template>
  <div class="min-h-screen bg-stone-100 text-stone-900">
    <header class="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-xs text-stone-500">研究用機率估計，不是投注指示</p>
          <NuxtLink to="/" class="truncate text-lg font-semibold hover:text-stone-700">
            {{ currentSportTitle }}
          </NuxtLink>
        </div>
        <nav class="flex shrink-0 flex-wrap justify-end gap-2" aria-label="主要">
          <NuxtLink
            v-for="link in currentNavLinks"
            :key="link.to"
            :to="link.to"
            class="rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            :class="{ [activeLinkClass]: isActive(link.to), 'bg-stone-100 text-stone-700': !isActive(link.to) }"
          >
            {{ link.label }}
          </NuxtLink>
          <NuxtLink
            to="/"
            class="rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            :class="isSportPicker ? activeLinkClass : 'bg-stone-100 text-stone-700'"
          >
            切換運動
          </NuxtLink>
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6" :class="{ 'pb-24': currentSport }">
      <slot />
    </main>
    <ParlaySlipDrawer v-if="currentSport" />
  </div>
</template>

<script setup lang="ts">
import {
  SPORT_BASE_PATH,
  SPORT_NAV_LINKS,
  sportActiveClass,
  sportFromPath,
  sportTitle,
} from '~~/shared/nav'

const route = useRoute()

const currentSport = computed(() => sportFromPath(route.path))
const currentNavLinks = computed(() => currentSport.value ? SPORT_NAV_LINKS[currentSport.value] : [])
const currentSportTitle = computed(() => sportTitle(currentSport.value))
const activeLinkClass = computed(() => sportActiveClass(currentSport.value))
const isSportPicker = computed(() => route.path === '/')

const isActive = (to: string) => {
  const sport = currentSport.value
  if (!sport) return false
  if (to === SPORT_BASE_PATH[sport]) return route.path === to
  return route.path.startsWith(to)
}
</script>
