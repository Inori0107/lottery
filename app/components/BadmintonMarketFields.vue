<template>
  <div class="grid gap-4 md:grid-cols-2">
    <fieldset
      v-for="(row, index) in model"
      :key="row.kind"
      class="min-w-0 rounded-xl border border-stone-200 p-3"
    >
      <legend class="px-1 text-sm font-medium">
        {{ marketLabelFor('badminton', row.kind) }}
      </legend>
      <label
        v-if="options(row.kind).length > 1"
        class="mb-3 block text-xs text-stone-500"
      >
        選擇盤口
        <select
          :value="row.sourceMarketId"
          class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm text-stone-900"
          :aria-label="`${marketLabelFor('badminton', row.kind)}選擇盤口`"
          @change="pick(index, $event)"
        >
          <option
            v-for="option in options(row.kind)"
            :key="option.id"
            :value="option.id"
          >
            {{ option.name }}{{ option.isMainline ? '（主盤）' : '' }}
          </option>
        </select>
      </label>
      <p v-else-if="sourceName(row)" class="mb-2 text-xs text-stone-500">
        {{ sourceName(row) }}
      </p>
      <label v-if="hasLine(row.kind)" class="mb-3 block text-xs text-stone-500">
        {{ isHandicap(row.kind) ? '盤口線（主隊讓分）' : '盤口線' }}
        <input
          v-model="row.line"
          type="number"
          step="any"
          class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm text-stone-900"
          :aria-label="`${marketLabelFor('badminton', row.kind)}盤口線`"
        />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label
          v-for="selection in row.selections"
          :key="selection.key"
          class="min-w-0 text-xs text-stone-500"
        >
          {{ selection.label }}
          <input
            v-model="selection.value"
            type="number"
            step="any"
            class="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm text-stone-900"
            :aria-label="`${marketLabelFor('badminton', row.kind)} ${selection.label}賠率`"
          />
        </label>
      </div>
      <p
        v-if="errors[row.kind]"
        class="mt-2 text-xs text-amber-900"
        role="status"
      >
        {{ errors[row.kind] }}
      </p>
    </fieldset>
  </div>
</template>
<script setup lang="ts">
import type { BetMarket, FixtureMarket } from '~~/shared/types'
import { marketLabelFor } from '~~/shared/types'
import {
  hasLine,
  isHandicap,
  inputForMarket,
  type MarketInput,
} from '~/utils/badmintonMarkets'
const model = defineModel<MarketInput[]>({ required: true })
const props = defineProps<{
  markets?: FixtureMarket[]
  errors: Partial<Record<BetMarket, string>>
}>()
const options = (kind: BetMarket) =>
  (props.markets ?? []).filter(
    (m) => m.market === kind && m.status === 'available',
  )
const sourceName = (row: MarketInput) =>
  props.markets?.find((m) => m.id === row.sourceMarketId)?.name
const pick = (index: number, event: Event) => {
  const id = (event.target as HTMLSelectElement).value
  const market = props.markets?.find((m) => m.id === id)
  if (!market?.market) return
  model.value = model.value.map((row, i) =>
    i === index ? inputForMarket(market.market!, market) : row,
  )
}
</script>
