<template>
  <div class="min-h-screen bg-stone-100 text-stone-900">
    <header class="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-xs text-stone-500">研究用機率估計，不是投注指示</p>
          <p class="truncate text-lg font-semibold">羽球對局估計</p>
        </div>
        <nav class="flex shrink-0 flex-wrap justify-end gap-2" aria-label="主要">
          <NuxtLink
            v-for="link in NAV_LINKS"
            :key="link.to"
            :to="link.to"
            class="rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            :class="{ 'bg-stone-900 text-white': isActive(link.to), 'bg-stone-100 text-stone-700': !isActive(link.to) }"
          >
            {{ link.label }}
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

const NAV_LINKS: NavLink[] = [
  { to: '/', label: '計算' },
  { to: '/bets', label: '投注紀錄' },
  { to: '/tsl-sync', label: '賠率同步' },
  { to: '/matches', label: '已匯入賽事' },
  { to: '/draw', label: '抽籤分組' },
]

const route = useRoute()

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>
