<template>
  <fieldset class="min-w-0">
    <legend class="text-sm font-medium">{{ label }}</legend>
    <div class="relative mt-2">
      <input
        ref="inputRef"
        v-model="searchText"
        type="text"
        class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        :placeholder="`搜尋${label}隊伍名稱`"
        :aria-label="`${label}隊伍名稱`"
        autocomplete="off"
        @focus="handleFocus"
        @blur="handleBlur"
        @input="handleInput"
        @keydown="handleKeydown"
      >
      <ul
        v-if="showSuggestions && suggestions.length > 0"
        class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg"
        role="listbox"
      >
        <li
          v-for="(team, index) in suggestions"
          :key="team.id"
          class="cursor-pointer px-3 py-2 text-sm hover:bg-stone-100"
          :class="{ 'bg-stone-100': index === highlightIndex }"
          role="option"
          :aria-selected="index === highlightIndex"
          @mousedown.prevent="handleSelect(team)"
        >
          <span class="font-medium">{{ team.name }}</span>
          <span class="ml-2 text-xs text-stone-500">
            Elo {{ team.elo.toFixed(0) }} · {{ team.matchCount }} 場
          </span>
        </li>
      </ul>
    </div>
    <p v-if="modelValue" class="mt-1 text-xs text-stone-500">
      Elo {{ modelValue.elo.toFixed(0) }}，{{ modelValue.matchCount }} 場，
      最後出賽 {{ modelValue.lastPlayedOn ?? '—' }}
    </p>
  </fieldset>
</template>

<script setup lang="ts">
import type { TeamOption, VolleyballDiscipline } from '~~/shared/types'

const props = defineProps<{
  modelValue: TeamOption | null
  label: string
  discipline: VolleyballDiscipline
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TeamOption | null]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const searchText = ref('')
const suggestions = ref<TeamOption[]>([])
const showSuggestions = ref(false)
const highlightIndex = ref(0)
const isLoading = ref(false)

watch(() => props.modelValue, (newValue) => {
  if (newValue) {
    searchText.value = newValue.name
  }
}, { immediate: true })

watch(() => props.discipline, () => {
  searchText.value = ''
  emit('update:modelValue', null)
})

const fetchSuggestions = async (query: string) => {
  if (query.length < 2) {
    suggestions.value = []
    return
  }

  isLoading.value = true
  try {
    const result = await $fetch<TeamOption[]>('/api/volleyball/teams', {
      query: {
        q: query,
        discipline: props.discipline,
        limit: 10,
      },
    })
    suggestions.value = result
    highlightIndex.value = 0
  } catch {
    suggestions.value = []
  } finally {
    isLoading.value = false
  }
}

const handleFocus = () => {
  showSuggestions.value = true
  if (searchText.value.length >= 2) {
    void fetchSuggestions(searchText.value)
  }
}

const handleBlur = () => {
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

const handleInput = () => {
  void fetchSuggestions(searchText.value)
}

const handleSelect = (team: TeamOption) => {
  emit('update:modelValue', team)
  searchText.value = team.name
  showSuggestions.value = false
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!showSuggestions.value || suggestions.value.length === 0) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      highlightIndex.value = (highlightIndex.value + 1) % suggestions.value.length
      break
    case 'ArrowUp':
      event.preventDefault()
      highlightIndex.value = (highlightIndex.value - 1 + suggestions.value.length) % suggestions.value.length
      break
    case 'Enter':
      event.preventDefault()
      if (suggestions.value[highlightIndex.value]) {
        handleSelect(suggestions.value[highlightIndex.value]!)
      }
      break
    case 'Escape':
      showSuggestions.value = false
      break
  }
}
</script>
