<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center">
    <h1 class="text-3xl font-bold text-stone-900">選擇運動項目</h1>
    <p class="mt-2 text-stone-600">選擇您要進行抽籤分組的運動類型</p>
    
    <div class="mt-8 grid gap-6 sm:grid-cols-2">
      <NuxtLink
        to="/draw/badminton"
        class="group flex flex-col items-center rounded-2xl border-2 border-stone-200 bg-white p-8 transition-all hover:border-emerald-500 hover:shadow-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500"
        tabindex="0"
        aria-label="羽球抽籤分組"
      >
        <div class="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-100 text-5xl transition-transform group-hover:scale-110">
          🏸
        </div>
        <h2 class="mt-4 text-xl font-semibold text-stone-900">羽球</h2>
        <p class="mt-1 text-center text-sm text-stone-500">單打或雙打分組</p>
        <ul class="mt-3 space-y-1 text-xs text-stone-400">
          <li>• 支援單打（1v1）</li>
          <li>• 支援雙打（2v2）</li>
          <li>• 可設定場地數量</li>
        </ul>
      </NuxtLink>
      
      <NuxtLink
        to="/draw/volleyball"
        class="group flex flex-col items-center rounded-2xl border-2 border-stone-200 bg-white p-8 transition-all hover:border-orange-500 hover:shadow-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500"
        tabindex="0"
        aria-label="排球抽籤分組"
      >
        <div class="flex h-24 w-24 items-center justify-center rounded-full bg-orange-100 text-5xl transition-transform group-hover:scale-110">
          🏐
        </div>
        <h2 class="mt-4 text-xl font-semibold text-stone-900">排球</h2>
        <p class="mt-1 text-center text-sm text-stone-500">6人制團隊分組</p>
        <ul class="mt-3 space-y-1 text-xs text-stone-400">
          <li>• 6人制隊伍</li>
          <li>• 自動輪換配對</li>
          <li>• 積分排名統計</li>
        </ul>
      </NuxtLink>
    </div>
    
    <div class="mt-12 rounded-xl bg-stone-50 px-6 py-4 text-center">
      <p class="text-sm text-stone-500">
        需要估計對局勝率？前往
        <NuxtLink to="/" class="font-medium text-emerald-700 underline hover:text-emerald-900">羽球對局估計</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: '抽籤分組 - 選擇運動' })
</script>
