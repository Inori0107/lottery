<template>
  <div>
    <h1 class="text-2xl font-semibold">賽後覆盤</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      只看預測當下留下的快照與完賽結果，沒有合成資料。CLV 用開賽前最後一筆運彩同步當收盤代理；若預測之後沒有新的賠率快照則為空。
    </p>

    <form class="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6" @submit.prevent="handleRefresh">
      <label class="block text-xs text-stone-500">
        運動
        <select v-model="filters.sport" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option value="">全部</option>
          <option value="badminton">羽球</option>
          <option value="volleyball">排球</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500">
        玩法
        <select v-model="filters.market" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option value="">全部</option>
          <option v-for="market in BET_MARKETS" :key="market" :value="market">{{ betMarketLabel[market] }}</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500">
        賽事
        <input v-model="filters.competition" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="text">
      </label>
      <label class="block text-xs text-stone-500">
        動作
        <select v-model="filters.action" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option value="">全部</option>
          <option value="candidate">候選</option>
          <option value="watch">觀望</option>
          <option value="pass">不投</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500">
        資料充足
        <select v-model="filters.dataSufficient" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
          <option value="all">全部</option>
          <option value="yes">充足</option>
          <option value="no">不足</option>
        </select>
      </label>
      <label class="block text-xs text-stone-500">
        起
        <input v-model="filters.from" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="date">
      </label>
      <label class="block text-xs text-stone-500">
        迄
        <input v-model="filters.to" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="date">
      </label>
      <div class="flex items-end gap-2 sm:col-span-2">
        <button type="submit" class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">套用</button>
        <button type="button" class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50" @click="handleCopySummary">複製日摘要</button>
      </div>
    </form>

    <p v-if="pending" class="mt-4 text-sm text-stone-500">讀取中…</p>
    <p v-else-if="error" class="mt-4 text-sm text-rose-700" role="alert">讀不到覆盤：{{ error.message }}</p>
    <template v-else-if="report">
      <p v-if="report.nSmallWarning" class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{{ report.nSmallWarning }}</p>
      <section class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article class="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 class="text-xs text-stone-500">樣本</h2>
          <p class="text-2xl font-semibold">{{ report.n }}</p>
        </article>
        <article class="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 class="text-xs text-stone-500">命中率</h2>
          <p class="text-2xl font-semibold">{{ formatPercent(report.hitRate) }}</p>
        </article>
        <article class="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 class="text-xs text-stone-500">已標記 ROI</h2>
          <p class="text-2xl font-semibold">{{ formatPercent(report.roi) }}</p>
        </article>
        <article class="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 class="text-xs text-stone-500">平均 CLV（代理）</h2>
          <p class="text-2xl font-semibold">{{ formatPercent(report.averageClv) }}</p>
          <p class="text-xs text-stone-500">{{ report.clvCount }} 筆有預測後快照</p>
        </article>
      </section>

      <section class="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4" aria-label="三個機率來源">
        <h2 class="text-base font-semibold">模型原始 vs 質化調整 vs 盤口去水</h2>
        <table class="mt-3 w-full text-left text-sm">
          <thead>
            <tr class="text-xs text-stone-500">
              <th class="py-2 pr-3">來源</th>
              <th class="py-2 pr-3">n</th>
              <th class="py-2 pr-3">Brier</th>
              <th class="py-2 pr-3">Log loss</th>
              <th class="py-2">說明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in report.sources" :key="source.source" class="border-t border-stone-100">
              <td class="py-2 pr-3 font-medium">{{ source.label }}</td>
              <td class="py-2 pr-3">{{ source.n }}</td>
              <td class="py-2 pr-3">{{ source.brier?.toFixed(3) ?? '—' }}</td>
              <td class="py-2 pr-3">{{ source.logLoss?.toFixed(3) ?? '—' }}</td>
              <td class="py-2 text-amber-800">{{ source.warning ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-for="source in report.sources" :key="`${source.source}-cal`" class="mt-4">
          <h3 class="text-sm font-medium">{{ source.label }} 校準分箱</h3>
          <p class="text-xs text-stone-500">預測機率對上實際命中率，n 太小時不要解讀。</p>
          <ul class="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <li v-for="bin in source.calibration" :key="`${source.source}-${bin.lo}`" class="rounded-lg bg-stone-50 px-2 py-2">
              {{ Math.round(bin.lo * 100) }}–{{ Math.round(bin.hi * 100) }}%
              n={{ bin.n }}
              預測 {{ formatPercent(bin.predicted) }}
              實際 {{ formatPercent(bin.actual) }}
            </li>
          </ul>
        </div>
      </section>

      <section class="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4">
        <h2 class="text-base font-semibold">每筆預測</h2>
        <table class="mt-3 min-w-[80rem] w-full text-left text-sm">
          <thead>
            <tr class="text-xs text-stone-500">
              <th class="py-2 pr-3">對局</th>
              <th class="py-2 pr-3">玩法</th>
              <th class="py-2 pr-3">動作</th>
              <th class="py-2 pr-3">模型</th>
              <th class="py-2 pr-3">質化</th>
              <th class="py-2 pr-3">去水</th>
              <th class="py-2 pr-3">結果</th>
              <th class="py-2 pr-3">CLV 代理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.rows" :key="row.id" class="border-t border-stone-100 align-top">
              <td class="py-2 pr-3">
                {{ row.awayLabel }}
              </td>
              <td class="py-2 pr-3">{{ row.market }} {{ row.outcomeLabel }}</td>
              <td class="py-2 pr-3">{{ row.decisionAction }}</td>
              <td class="py-2 pr-3">{{ formatPercent(row.modelRaw) }}</td>
              <td class="py-2 pr-3">{{ formatPercent(row.qualitativeAdjusted) }}</td>
              <td class="py-2 pr-3">{{ formatPercent(row.marketVigRemoved) }}</td>
              <td class="py-2 pr-3">{{ resultLabel[row.result] }}{{ row.hit === null ? '' : row.hit ? '／中' : '／不中' }}</td>
              <td class="py-2 pr-3">{{ row.clv === null ? '—' : formatPercent(row.clv) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { BET_MARKETS, betMarketLabel } from '~~/shared/types'

useHead({ title: '賽後覆盤' })

type Report = {
  n: number
  nSmallWarning: string | null
  hitRate: number | null
  roi: number | null
  staked: number
  profit: number
  clvCount: number
  averageClv: number | null
  sources: Array<{
    source: string
    label: string
    n: number
    brier: number | null
    logLoss: number | null
    calibration: Array<{ lo: number, hi: number, n: number, predicted: number | null, actual: number | null }>
    warning: string | null
  }>
  rows: Array<{
    id: string
    market: string
    outcomeLabel: string
    decisionAction: string
    modelRaw: number | null
    qualitativeAdjusted: number | null
    marketVigRemoved: number | null
    result: string
    hit: boolean | null
    clv: number | null
    tournament: string
    awayLabel?: string
  }>
}

const filters = reactive({
  sport: 'badminton',
  market: '',
  competition: '',
  action: '',
  dataSufficient: 'all',
  from: '',
  to: '',
})

const query = computed(() => ({
  sport: filters.sport || undefined,
  market: filters.market || undefined,
  competition: filters.competition || undefined,
  action: filters.action || undefined,
  dataSufficient: filters.dataSufficient === 'all' ? undefined : filters.dataSufficient,
  from: filters.from || undefined,
  to: filters.to || undefined,
}))

const { data, error, pending, refresh } = await useFetch<Report>('/api/review', { query, watch: false })
const report = computed(() => {
  const value = data.value
  if (!value) return null
  return {
    ...value,
    rows: value.rows.map(row => ({
      ...row,
      awayLabel: `${row.tournament} ${row.outcomeLabel}`,
    })),
  }
})

const resultLabel: Record<string, string> = {
  won: '贏',
  lost: '輸',
  void: '作廢',
  unresolved: '未完賽',
  open: '未完賽',
}

const handleRefresh = () => {
  void refresh()
}

const handleCopySummary = async () => {
  try {
    const summary = await $fetch<{ text: string }>('/api/review/summary?period=daily')
    await navigator.clipboard.writeText(summary.text)
  } catch (copyError) {
    window.alert(apiErrorMessage(copyError, '複製摘要失敗'))
  }
}
</script>
