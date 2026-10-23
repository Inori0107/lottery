<template>
  <div class="relative min-w-0">
    <label :for="inputId" class="mb-1 block text-sm font-medium">{{ label }}</label>
    <input
      :id="inputId"
      :value="query"
      type="text"
      role="combobox"
      autocomplete="off"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined"
      aria-autocomplete="list"
      class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700"
      :placeholder="`${label}英文姓名，例如 Dong, Tian Yao`"
      @input="handleInput"
      @focus="handleFocus"
      @keydown="handleKeyDown"
    >
    <p v-if="modelValue" class="mt-1 text-xs wrap-break-word text-stone-500">
      已選擇 {{ modelValue.name }}，全場 {{ modelValue.matchCount }} 場，第一盤/局 {{ modelValue.set1Count }} 場
    </p>
    <ul
      v-if="open"
      :id="listId"
      role="listbox"
      :aria-label="label"
      class="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg"
    >
      <li v-if="options.length === 0" class="px-3 py-2 text-sm text-stone-500">沒有符合的選手</li>
      <li
        v-for="(option, index) in options"
        :id="`${listId}-${index}`"
        :key="option.id"
        role="option"
        :aria-selected="index === activeIndex"
        tabindex="0"
        class="cursor-pointer px-3 py-2 text-sm wrap-break-word"
        :class="{ 'bg-emerald-50': index === activeIndex }"
        @click="selectOption(option)"
        @keydown.enter.prevent="selectOption(option)"
      >
        <span class="font-medium">{{ option.name }}</span>
        <span class="ml-2 text-stone-500">{{ option.matchCount }} 場</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { Discipline, PlayerOption } from '~~/shared/types'

const props = defineProps<{
  label: string
  discipline: Discipline
  modelValue: PlayerOption | null
  endpoint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PlayerOption | null]
}>()

const inputId = useId()
const listId = useId()
const query = ref('')
const options = ref<PlayerOption[]>([])
const open = ref(false)
const activeIndex = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.modelValue, (value) => {
  if (value) query.value = value.name
})

watch(() => props.discipline, () => {
  query.value = ''
  options.value = []
  open.value = false
  emit('update:modelValue', null)
})

const loadOptions = async () => {
  options.value = await $fetch<PlayerOption[]>(props.endpoint ?? '/api/players', {
    query: { discipline: props.discipline, q: query.value },
  })
  activeIndex.value = 0
  open.value = true
}

const handleFocus = () => {
  void loadOptions()
}

const handleInput = (event: Event) => {
  query.value = (event.target as HTMLInputElement).value
  emit('update:modelValue', null)
  clearTimeout(timer)
  timer = setTimeout(() => {
    void loadOptions()
  }, 200)
}

const selectOption = (option: PlayerOption) => {
  query.value = option.name
  emit('update:modelValue', option)
  open.value = false
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!open.value) {
      void loadOptions()
      return
    }
    activeIndex.value = Math.min(activeIndex.value + 1, Math.max(options.value.length - 1, 0))
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  }
  if (event.key === 'Enter' && open.value) {
    event.preventDefault()
    const option = options.value[activeIndex.value]
    if (option) selectOption(option)
  }
  if (event.key === 'Escape') open.value = false
}
</script>
