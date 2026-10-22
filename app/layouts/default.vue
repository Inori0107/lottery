<template>
  <div class="min-h-screen bg-stone-100 text-stone-900">
    <header class="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-xs text-stone-500">研究用機率估計，不是投注指示</p>
          <NuxtLink to="/sport" class="truncate text-lg font-semibold hover:text-stone-700">
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
            to="/sport"
            class="rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            :class="route.path === '/sport' ? activeLinkClass : 'bg-stone-100 text-stone-700'"
          >
            切換運動
          </NuxtLink>
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
type NavLink = { to: string, label: string }

const BADMINTON_NAV_LINKS: NavLink[] = [
  { to: '/', label: '計算' },
  { to: '/bets', label: '投注紀錄' },
  { to: '/tsl-sync', label: '賠率同步' },
  { to: '/matches', label: '已匯入賽事' },
]

const VOLLEYBALL_NAV_LINKS: NavLink[] = [
  { to: '/volleyball', label: '計算' },
  { to: '/volleyball/bets', label: '投注紀錄' },
  { to: '/volleyball/tsl-sync', label: '賠率同步' },
  { to: '/volleyball/matches', label: '已匯入賽事' },
]

const route = useRoute()

const isVolleyball = computed(() => route.path.startsWith('/volleyball'))

const currentNavLinks = computed(() =>
  isVolleyball.value ? VOLLEYBALL_NAV_LINKS : BADMINTON_NAV_LINKS
)

const currentSportTitle = computed(() =>
  isVolleyball.value ? '排球對局估計 🏐' : '羽球對局估計 🏸'
)

const activeLinkClass = computed(() =>
  isVolleyball.value ? 'bg-orange-700 text-white' : 'bg-stone-900 text-white'
)

const isActive = (to: string) => {
  if (to === '/' && !isVolleyball.value) return route.path === '/'
  if (to === '/volleyball' && isVolleyball.value) return route.path === '/volleyball'
  return route.path.startsWith(to) && to !== '/' && to !== '/volleyball'
}
</script>
