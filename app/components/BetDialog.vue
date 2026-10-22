<template>
  <div
    v-if="draft"
    class="fixed inset-0 z-30 flex items-center justify-center bg-stone-900/40 p-4"
    @click.self="handleClose"
    @keydown.esc="handleClose"
  >
    <form
      class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @submit.prevent="handleSubmit"
    >
      <h2 :id="titleId" class="text-base font-semibold">記錄投注</h2>
      <p class="mt-2 wrap-break-word text-sm text-stone-700">
        {{ draft.awayName }} 對 {{ draft.homeName }}
      </p>
      <p class="text-sm font-medium">{{ betMarketLabel[draft.market] }}：{{ draft.outcomeLabel }}</p>
      <p class="mt-1 text-xs text-stone-500">
        校準機率 {{ formatPercent(draft.probability) }}，期望值 {{ draft.ev === null ? '—' : draft.ev.toFixed(3) }}，模型動作 {{ draft.action ? marketActionLabel[draft.action] : '—' }}
      </p>
      <p v-if="draft.fixtureId === null" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        這筆沒有對上運彩場次，不會自動結算，之後要在投注紀錄頁手動標記輸贏。
      </p>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <label class="block min-w-0 text-xs text-stone-500" :for="oddsId">
          下注賠率
          <input :id="oddsId" ref="oddsInput" v-model="oddsText" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" required aria-label="實際下注的十進位賠率">
        </label>
        <label class="block min-w-0 text-xs text-stone-500" :for="stakeId">
          金額
          <input :id="stakeId" v-model="stakeText" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1" step="1" inputmode="numeric" required aria-label="投注金額">
        </label>
        <label class="col-span-2 block min-w-0 text-xs text-stone-500" :for="noteId">
          備註
          <input :id="noteId" v-model="note" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="text" maxlength="500" aria-label="投注備註">
        </label>
      </div>
      <p v-if="errorMessage" class="mt-3 text-sm text-rose-700" role="alert">{{ errorMessage }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900"
          @click="handleClose"
        >
          取消
        </button>
        <button
          type="submit"
          class="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-700 disabled:opacity-50"
          :disabled="saving"
        >
          儲存
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { betMarketLabel, type BetDraft, type BetRecord } from '~~/shared/types'
import { marketActionLabel } from '~~/shared/decision'

const props = defineProps<{
  draft: BetDraft | null
}>()

const emit = defineEmits<{
  close: []
  saved: [bet: BetRecord]
}>()

const titleId = useId()
const oddsId = useId()
const stakeId = useId()
const noteId = useId()
const oddsInput = ref<HTMLInputElement | null>(null)
const oddsText = ref<string | number>('')
const stakeText = ref<string | number>('')
const note = ref('')
const errorMessage = ref('')
const saving = ref(false)

watch(() => props.draft, async (draft) => {
  if (!draft) return
  oddsText.value = draft.odds
  note.value = ''
  errorMessage.value = ''
  await nextTick()
  oddsInput.value?.focus()
})

const handleClose = () => {
  emit('close')
}

const handleSubmit = async () => {
  const draft = props.draft
  if (!draft) return
  const odds = Number(oddsText.value)
  const stake = Number(stakeText.value)
  if (!(odds > 1) || !(stake > 0)) {
    errorMessage.value = '賠率要大於 1，金額要大於 0'
    return
  }
  saving.value = true
  try {
    const bet = await $fetch<BetRecord>('/api/bets', {
      method: 'POST',
      body: { ...draft, odds, stake, note: note.value.trim() },
    })
    emit('saved', bet)
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '儲存失敗')
  } finally {
    saving.value = false
  }
}
</script>
