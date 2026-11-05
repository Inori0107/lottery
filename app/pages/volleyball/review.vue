<template>
  <p class="text-sm text-stone-500">轉到覆盤頁…</p>
</template>

<script setup lang="ts">
await navigateTo('/review', { replace: true })
</script>
