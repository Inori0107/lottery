<template>
  <div>
    <h1 class="text-2xl font-semibold">排球對局估計</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      在「今日對局」一鍵帶入運彩賽事，或到「隊伍與賠率」自己輸入。全場與第 1 盤分開估計；總分大小、總分讓分、局數讓分、正確比數用每球得分模型推算。結果頁可以記錄實際下注。
    </p>

    <p v-if="status && !status.ready" class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
      尚未完成回測。請先執行 <code>npm run update:data</code>，或等開發伺服器啟動後自動更新完成。
    </p>

    <div class="mt-6 flex flex-wrap gap-2 border-b border-stone-200" role="tablist" aria-label="計算步驟">
      <button
        v-for="(tab, index) in QUOTE_TABS"
        :id="`quote-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        class="-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
        :class="{
          'border-orange-800 text-orange-900': activeTab === tab.id,
          'border-transparent text-stone-500 hover:text-stone-800': activeTab !== tab.id,
        }"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`quote-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :disabled="!isTabEnabled(tab.id)"
        @click="handleSelectTab(tab.id)"
        @keydown="event => handleTabKeydown(event, index)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-show="activeTab === 'fixtures'" id="quote-panel-fixtures" class="mt-4" role="tabpanel" aria-labelledby="quote-tab-fixtures">
      <VolleyballFixtureList :active-id="activeFixture?.sportradarId ?? null" @select="handleSelectFixture" />
    </div>

    <form
      v-show="activeTab === 'form'"
      id="quote-panel-form"
      class="mt-4 space-y-5 rounded-2xl border border-stone-200 bg-white p-4"
      role="tabpanel"
      aria-labelledby="quote-tab-form"
      @submit.prevent="handleSubmit"
    >
      <fieldset>
        <legend class="mb-2 text-sm font-medium">項目</legend>
        <div class="flex flex-wrap gap-2">
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'M' ? 'border-orange-900 bg-orange-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="M">
            男排
          </label>
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'W' ? 'border-orange-900 bg-orange-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="W">
            女排
          </label>
        </div>
      </fieldset>

      <div class="grid gap-4 md:grid-cols-2">
        <TeamField v-model="form.away" class="min-w-0" label="客隊" :discipline="form.discipline" />
        <TeamField v-model="form.home" class="min-w-0" label="主隊" :discipline="form.discipline" />
      </div>

      <fieldset>
        <legend class="mb-2 text-sm font-medium">主場設定</legend>
        <div class="flex flex-wrap gap-2">
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.isHome ? 'border-orange-700 bg-orange-100' : 'border-stone-300'">
            <input v-model="form.isHome" class="sr-only" type="checkbox">
            {{ form.isHome ? '主隊為地主隊' : '中性場地' }}
          </label>
        </div>
      </fieldset>

      <div class="grid gap-4 md:grid-cols-2">
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">全場不讓分賠率</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block min-w-0 text-xs text-stone-500" for="match-away">
              客隊
              <input id="match-away" v-model="form.matchAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="match-home">
              主隊
              <input id="match-home" v-model="form.matchHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">[第1盤]不讓分賠率</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block min-w-0 text-xs text-stone-500" for="set1-away">
              客隊
              <input id="set1-away" v-model="form.set1AwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="set1-home">
              主隊
              <input id="set1-home" v-model="form.set1HomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">[總分]大小</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="total-line">
              盤口線
              <input id="total-line" v-model="form.totalLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0.5" step="1" placeholder="180.5" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="total-over">
              大
              <input id="total-over" v-model="form.totalOverOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="total-under">
              小
              <input id="total-under" v-model="form.totalUnderOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">[總分]讓分</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-line">
              盤口線
              <input id="handicap-line" v-model="form.handicapHomeLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="-99.5" step="1" placeholder="-8.5" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-away">
              客隊
              <input id="handicap-away" v-model="form.handicapAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-home">
              主隊
              <input id="handicap-home" v-model="form.handicapHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">局數讓分</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="set-handicap-line">
              盤口線
              <input id="set-handicap-line" v-model="form.setHandicapHomeLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="-2.5" max="2.5" step="1" placeholder="-1.5" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="set-handicap-away">
              客隊
              <input id="set-handicap-away" v-model="form.setHandicapAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="set-handicap-home">
              主隊
              <input id="set-handicap-home" v-model="form.setHandicapHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">[第1盤]大小</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="set1-total-line">
              盤口線
              <input id="set1-total-line" v-model="form.set1TotalLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0.5" step="1" placeholder="48.5" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="set1-total-over">
              大
              <input id="set1-total-over" v-model="form.set1TotalOverOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="set1-total-under">
              小
              <input id="set1-total-under" v-model="form.set1TotalUnderOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
            </label>
          </div>
        </fieldset>
      </div>

      <fieldset class="min-w-0">
        <legend class="text-sm font-medium">正確比數（客:主）</legend>
        <div class="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
          <label
            v-for="score in VOLLEYBALL_SCORES"
            :key="score"
            class="block min-w-0 text-xs text-stone-500"
            :for="`score-${score}`"
          >
            {{ score }}
            <input :id="`score-${score}`" v-model="form.correctScoreOdds[score]" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        class="rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-orange-700"
      >
        計算
      </button>
      <p v-if="errorMessage" class="text-sm text-rose-700" role="alert">{{ errorMessage }}</p>
    </form>

    <div
      v-if="result"
      v-show="activeTab === 'result'"
      id="quote-panel-result"
      class="mt-4 space-y-4"
      role="tabpanel"
      aria-labelledby="quote-tab-result"
    >
      <div class="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-600">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="wrap-break-word text-base font-semibold text-stone-900">
            {{ result.away.name }} 對 {{ result.home.name }}
            <span class="ml-1 text-xs font-normal text-stone-500">{{ disciplineLabelFull[result.discipline] }}</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50"
              @click="handleSelectTab('form')"
            >
              修改賠率
            </button>
          </div>
        </div>
        <p>資料截至 {{ result.dataThrough }}。報價日 {{ result.asOf }}。模型 {{ result.modelVersion }}。</p>
        <p>
          客隊最後出賽 {{ result.away.lastPlayedOn ?? '—' }}，{{ result.away.matchCount }} 場。
          主隊最後出賽 {{ result.home.lastPlayedOn ?? '—' }}，{{ result.home.matchCount }} 場。
          <span v-if="result.isHome" class="text-orange-700">（主隊為地主）</span>
        </p>
      </div>

      <ul v-if="(result.warnings ?? []).length > 0" class="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
      </ul>

      <div class="grid gap-4 md:grid-cols-2">
        <MarketCard
          title="全場不讓分"
          :away-name="result.away.name"
          :home-name="result.home.name"
          :quote="result.matchWinner"
        />
        <MarketCard
          title="[第1盤]不讓分"
          :away-name="result.away.name"
          :home-name="result.home.name"
          :quote="result.set1Winner"
        />
        <OutcomeMarketCard v-if="result.totalPoints" title="[總分]大小" :quote="result.totalPoints" />
        <OutcomeMarketCard v-if="result.pointsHandicap" title="[總分]讓分" :quote="result.pointsHandicap" />
        <OutcomeMarketCard v-if="result.setHandicap" title="局數讓分" :quote="result.setHandicap" />
        <OutcomeMarketCard v-if="result.set1TotalPoints" title="[第1盤]大小" :quote="result.set1TotalPoints" />
        <OutcomeMarketCard v-if="result.set1PointsHandicap" title="[第1盤]讓分" :quote="result.set1PointsHandicap" />
        <OutcomeMarketCard v-if="result.correctScore" class="md:col-span-2" title="正確比數（客:主）" :quote="result.correctScore" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VolleyballDiscipline, QuoteResponse, FixtureSummary, StatusResponse, TeamOption, VolleyballCorrectScore } from '~~/shared/types'
import { VOLLEYBALL_CORRECT_SCORES, isTeamOption } from '~~/shared/types'
import { disciplineLabelFull } from '~~/shared/sports'
import { isHalfLine } from '~~/shared/decision'

type QuoteTab = 'fixtures' | 'form' | 'result'

const QUOTE_TABS: Array<{ id: QuoteTab, label: string }> = [
  { id: 'fixtures', label: '今日對局' },
  { id: 'form', label: '隊伍與賠率' },
  { id: 'result', label: '計算結果' },
]

const VOLLEYBALL_SCORES = VOLLEYBALL_CORRECT_SCORES

useHead({ title: '排球對局估計' })

const { data: status } = await useAsyncData('volleyball-model-status', () =>
  $fetch<StatusResponse>('/api/volleyball/status')
)

type VolleyballFormState = {
  discipline: VolleyballDiscipline
  away: TeamOption | null
  home: TeamOption | null
  isHome: boolean
  matchAwayOdds: string | number
  matchHomeOdds: string | number
  set1AwayOdds: string | number
  set1HomeOdds: string | number
  totalLine: string | number
  totalOverOdds: string | number
  totalUnderOdds: string | number
  handicapHomeLine: string | number
  handicapAwayOdds: string | number
  handicapHomeOdds: string | number
  setHandicapHomeLine: string | number
  setHandicapAwayOdds: string | number
  setHandicapHomeOdds: string | number
  set1TotalLine: string | number
  set1TotalOverOdds: string | number
  set1TotalUnderOdds: string | number
  correctScoreOdds: Record<VolleyballCorrectScore, string | number>
}

const emptyForm = (): VolleyballFormState => ({
  discipline: 'M',
  away: null,
  home: null,
  isHome: true,
  matchAwayOdds: '',
  matchHomeOdds: '',
  set1AwayOdds: '',
  set1HomeOdds: '',
  totalLine: '',
  totalOverOdds: '',
  totalUnderOdds: '',
  handicapHomeLine: '',
  handicapAwayOdds: '',
  handicapHomeOdds: '',
  setHandicapHomeLine: '',
  setHandicapAwayOdds: '',
  setHandicapHomeOdds: '',
  set1TotalLine: '',
  set1TotalOverOdds: '',
  set1TotalUnderOdds: '',
  correctScoreOdds: Object.fromEntries(VOLLEYBALL_SCORES.map(s => [s, ''])) as Record<VolleyballCorrectScore, string | number>,
})

const form = reactive<VolleyballFormState>(emptyForm())
const result = ref<QuoteResponse | null>(null)
const errorMessage = ref('')
const activeTab = ref<QuoteTab>('fixtures')
const activeFixture = ref<FixtureSummary | null>(null)

const isTabEnabled = (tab: QuoteTab) => tab !== 'result' || result.value !== null

const handleSelectTab = (tab: QuoteTab) => {
  if (!isTabEnabled(tab)) return
  activeTab.value = tab
}

const handleTabKeydown = (event: KeyboardEvent, index: number) => {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
  const step = steps[event.key]
  if (!step) return
  event.preventDefault()
  const enabledTabs = QUOTE_TABS.filter(tab => isTabEnabled(tab.id))
  const currentIndex = enabledTabs.findIndex(tab => tab.id === QUOTE_TABS[index]?.id)
  const next = enabledTabs[(currentIndex + step + enabledTabs.length) % enabledTabs.length]
  if (!next) return
  handleSelectTab(next.id)
  document.getElementById(`quote-tab-${next.id}`)?.focus()
}

const isBlank = (value: string | number) => String(value).trim() === ''
const readOdds = (awayText: string | number, homeText: string | number) => {
  if (isBlank(awayText) && isBlank(homeText)) return undefined
  const away = Number(awayText)
  const home = Number(homeText)
  if (!(away > 1) || !(home > 1)) return null
  return { away, home }
}
const readLineOdds = (lineText: string | number, firstText: string | number, secondText: string | number) => {
  if ([lineText, firstText, secondText].every(isBlank)) return undefined
  const line = Number(lineText)
  const first = Number(firstText)
  const second = Number(secondText)
  if (!isHalfLine(line) || !(first > 1) || !(second > 1)) return null
  return { line, first, second }
}

const asTeam = (participant: FixtureSummary['away']) =>
  participant && isTeamOption(participant) ? participant : null

const handleSelectFixture = async (fixture: FixtureSummary) => {
  result.value = null
  activeFixture.value = fixture
  form.discipline = fixture.discipline === 'W' ? 'W' : 'M'
  await nextTick()
  form.away = asTeam(fixture.away)
  form.home = asTeam(fixture.home)
  form.matchAwayOdds = fixture.odds.match?.away ?? ''
  form.matchHomeOdds = fixture.odds.match?.home ?? ''
  form.set1AwayOdds = fixture.odds.set1?.away ?? ''
  form.set1HomeOdds = fixture.odds.set1?.home ?? ''
  form.totalLine = fixture.odds.totals?.line ?? ''
  form.totalOverOdds = fixture.odds.totals?.over ?? ''
  form.totalUnderOdds = fixture.odds.totals?.under ?? ''
  form.handicapHomeLine = fixture.odds.handicap?.homeLine ?? ''
  form.handicapAwayOdds = fixture.odds.handicap?.away ?? ''
  form.handicapHomeOdds = fixture.odds.handicap?.home ?? ''
  form.setHandicapHomeLine = fixture.odds.setHandicap?.homeLine ?? ''
  form.setHandicapAwayOdds = fixture.odds.setHandicap?.away ?? ''
  form.setHandicapHomeOdds = fixture.odds.setHandicap?.home ?? ''
  form.set1TotalLine = fixture.odds.set1Totals?.line ?? ''
  form.set1TotalOverOdds = fixture.odds.set1Totals?.over ?? ''
  form.set1TotalUnderOdds = fixture.odds.set1Totals?.under ?? ''
  if (!form.away || !form.home) {
    errorMessage.value = '賠率已帶入，但有隊伍對不上資料庫，請手動選擇後按計算'
    activeTab.value = 'form'
    return
  }
  await handleSubmit()
}

const handleSubmit = async () => {
  errorMessage.value = ''
  if (!form.away || !form.home) {
    errorMessage.value = '請從清單選擇客隊與主隊'
    activeTab.value = 'form'
    return
  }
  const matchOdds = readOdds(form.matchAwayOdds, form.matchHomeOdds)
  const set1Odds = readOdds(form.set1AwayOdds, form.set1HomeOdds)
  if (matchOdds === null || set1Odds === null) {
    errorMessage.value = '同一個玩法要填雙方賠率，而且都要大於 1'
    activeTab.value = 'form'
    return
  }
  const totals = readLineOdds(form.totalLine, form.totalOverOdds, form.totalUnderOdds)
  const handicap = readLineOdds(form.handicapHomeLine, form.handicapAwayOdds, form.handicapHomeOdds)
  const setHandicap = readLineOdds(form.setHandicapHomeLine, form.setHandicapAwayOdds, form.setHandicapHomeOdds)
  const set1Totals = readLineOdds(form.set1TotalLine, form.set1TotalOverOdds, form.set1TotalUnderOdds)
  if (totals === null || handicap === null || setHandicap === null || set1Totals === null) {
    errorMessage.value = '有填的盤口要整組填齊，賠率大於 1，盤口線要是 .5'
    activeTab.value = 'form'
    return
  }
  const scoreEntries = VOLLEYBALL_SCORES.map(score => [score, Number(form.correctScoreOdds[score])] as const)
  const filledScores = scoreEntries.filter(([, odds]) => Number.isFinite(odds) && odds > 1)
  try {
    result.value = await $fetch<QuoteResponse>('/api/volleyball/quote', {
      method: 'POST',
      body: {
        discipline: form.discipline,
        awayTeamId: form.away.id,
        homeTeamId: form.home.id,
        isHome: form.isHome,
        matchOdds,
        set1Odds,
        totalOdds: totals ? { line: totals.line, over: totals.first, under: totals.second } : undefined,
        handicapOdds: handicap ? { awayLine: -handicap.line, away: handicap.first, home: handicap.second } : undefined,
        setHandicapOdds: setHandicap ? { awayLine: -setHandicap.line, away: setHandicap.first, home: setHandicap.second } : undefined,
        set1TotalOdds: set1Totals ? { line: set1Totals.line, over: set1Totals.first, under: set1Totals.second } : undefined,
        correctScoreOdds: filledScores.length === VOLLEYBALL_SCORES.length ? Object.fromEntries(filledScores) : undefined,
      },
    })
    activeTab.value = 'result'
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '計算失敗')
    activeTab.value = 'form'
  }
}
</script>
