<template>
  <button
    type="button"
    class="shrink-0 rounded-lg border px-3 py-1.5 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2"
    :class="buttonClass"
    :aria-label="ariaLabel"
    :disabled="copying"
    @click="handleCopy"
  >
    {{ copying ? '複製中…' : copied ? '已複製分析包' : '複製分析包' }}
  </button>
</template>

<script setup lang="ts">
import type { FixtureSummary, QuoteResponse } from '~~/shared/types'

const props = defineProps<{
  fixtureId?: number | null
  fixture?: FixtureSummary | null
  quote?: QuoteResponse | null
  tone?: 'emerald' | 'orange' | 'stone'
}>()

const copying = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const buttonClass = computed(() => {
  if (props.tone === 'orange') return 'border-orange-300 text-orange-900 focus-visible:ring-orange-700'
  if (props.tone === 'stone') return 'border-stone-300 text-stone-800 focus-visible:ring-stone-900'
  return 'border-emerald-300 text-emerald-900 focus-visible:ring-emerald-700'
})

const ariaLabel = computed(() => {
  const fixture = props.fixture
  if (fixture) return `複製 ${fixture.awayName} 對 ${fixture.homeName} 的分析包`
  return '複製分析包'
})

const handleCopy = async () => {
  copying.value = true
  copied.value = false
  try {
    const result = await $fetch<{ text: string }>('/api/analysis-pack', {
      method: 'POST',
      body: {
        fixtureId: props.fixtureId ?? props.fixture?.sportradarId ?? undefined,
        quote: props.quote ?? undefined,
      },
    })
    await navigator.clipboard.writeText(result.text)
    copied.value = true
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2500)
  } catch (error) {
    window.alert(apiErrorMessage(error, '複製分析包失敗'))
  } finally {
    copying.value = false
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>
