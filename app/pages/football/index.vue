<template>
  <div>
    <h1 class="text-2xl font-semibold">足球對局估計</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      在「今日對局」一鍵帶入運彩賽事，或到「隊伍與賠率」自己輸入。足球使用 Poisson 進球模型估計 1X2（含和局）、大小球與讓球。模型資料不足時，僅顯示去水盤口機率。
    </p>

    <p v-if="status && !status.ready" class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
      足球模型資料尚未建立。請先同步運彩賠率，模型會顯示「模型資料不足，僅供參考」。
    </p>
    <ul v-if="status?.notes?.length" class="mt-4 space-y-1 rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
      <li v-for="note in status.notes" :key="note">{{ note }}</li>
    </ul>
    <div
      v-if="status?.latestMatch?.football"
      class="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs"
    >
      <p class="font-medium text-stone-700">最新一場已匯入比賽日期（台北時間）</p>
      <p class="mt-1 text-stone-600">
        男足：{{ status.latestMatch.football.FM.date ?? '—' }}
        <span
          v-if="status.latestMatch.football.FM.staleWarning"
          class="ml-2 text-amber-700"
        >⚠ {{ status.latestMatch.football.FM.staleWarning }}</span>
      </p>
      <p class="text-stone-600">
        女足：{{ status.latestMatch.football.FW.date ?? '—' }}
        <span
          v-if="status.latestMatch.football.FW.staleWarning"
          class="ml-2 text-amber-700"
        >⚠ {{ status.latestMatch.football.FW.staleWarning }}</span>
      </p>
    </div>

    <div class="mt-6 flex flex-wrap gap-2 border-b border-stone-200" role="tablist" aria-label="計算步驟">
      <button
        v-for="(tab, index) in QUOTE_TABS"
        :id="`quote-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        class="-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 disabled:cursor-not-allowed disabled:opacity-40"
        :class="{
          'border-green-800 text-green-900': activeTab === tab.id,
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
      <FixtureList sport="football" endpoint="/api/football/fixtures" sync-path="/football/tsl-sync" :active-id="activeFixture?.sportradarId ?? null" @select="handleSelectFixture" />
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
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'FM' ? 'border-green-900 bg-green-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="FM">
            男足
          </label>
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'FW' ? 'border-green-900 bg-green-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="FW">
            女足
          </label>
        </div>
      </fieldset>

      <div class="grid gap-4 md:grid-cols-2">
        <TeamField v-model="form.away" class="min-w-0" label="客隊" :discipline="form.discipline" sport="football" />
        <TeamField v-model="form.home" class="min-w-0" label="主隊" :discipline="form.discipline" sport="football" />
      </div>

      <fieldset>
        <legend class="mb-2 text-sm font-medium">主場設定</legend>
        <div class="flex flex-wrap gap-2">
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.isHome ? 'border-green-700 bg-green-100' : 'border-stone-300'">
            <input v-model="form.isHome" class="sr-only" type="checkbox">
            {{ form.isHome ? '主隊為地主隊' : '中性場地' }}
          </label>
        </div>
      </fieldset>

      <fieldset v-if="showMarket('match1X2')" class="min-w-0">
        <legend class="text-sm font-medium">不讓分（含和局）賠率</legend>
        <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="block min-w-0 text-xs text-stone-500" for="match-home">
            主勝
            <input id="match-home" v-model="form.match1X2Home" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
          </label>
          <label class="block min-w-0 text-xs text-stone-500" for="match-draw">
            和局
            <input id="match-draw" v-model="form.match1X2Draw" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
          </label>
          <label class="block min-w-0 text-xs text-stone-500" for="match-away">
            客勝
            <input id="match-away" v-model="form.match1X2Away" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal">
          </label>
        </div>
      </fieldset>

      <div class="grid gap-4 md:grid-cols-2">
        <fieldset v-if="showMarket('totals')" class="min-w-0">
          <legend class="text-sm font-medium">大小球</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="total-line">
              盤口線
              <input id="total-line" v-model="form.totalLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0.5" step="0.25" placeholder="2.5" inputmode="decimal">
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
        <fieldset v-if="showMarket('handicap')" class="min-w-0">
          <legend class="text-sm font-medium">讓球</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-line">
              主讓（正為讓出）
              <input id="handicap-line" v-model="form.handicapHomeLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" step="0.25" placeholder="-0.5" inputmode="decimal">
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

      <p v-if="ignoredMarkets.length" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        運彩還有這些盤，目前沒有模型：{{ ignoredMarkets.join('、') }}
      </p>

      <button
        type="submit"
        class="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-green-700"
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
          客隊 {{ result.away.matchCount }} 場。主隊 {{ result.home.matchCount }} 場。
          <span v-if="result.isHome" class="text-green-700">（主隊為地主）</span>
        </p>
        <p v-if="result.expectedGoalsHome !== null && result.expectedGoalsAway !== null">
          預期進球：主 {{ result.expectedGoalsHome?.toFixed(2) }} / 客 {{ result.expectedGoalsAway?.toFixed(2) }}
        </p>
      </div>

      <ul v-if="(result.warnings ?? []).length > 0" class="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
      </ul>

      <div v-if="result.match1X2" class="rounded-2xl border border-stone-200 bg-white p-4">
        <h3 class="font-medium">不讓分（含和局）</h3>
        <p class="mt-1 text-xs text-stone-500">
          狀態：{{ result.match1X2.status === 'ok' ? '模型可用' : '模型資料不足，僅供參考' }}
        </p>
        <div class="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div class="rounded-lg bg-stone-50 p-2">
            <div class="font-medium">主勝</div>
            <div class="text-xs text-stone-500">賠率 {{ result.match1X2.impliedHome ? (1 / result.match1X2.impliedHome).toFixed(2) : '—' }}</div>
            <div>模型 {{ pct(result.match1X2.probabilityCalibratedHome) }}</div>
            <div class="text-xs">去水 {{ pct(result.match1X2.marketHome) }}</div>
            <div :class="evClass(result.match1X2.evHome)">EV {{ evText(result.match1X2.evHome) }}</div>
          </div>
          <div class="rounded-lg bg-stone-50 p-2">
            <div class="font-medium">和局</div>
            <div class="text-xs text-stone-500">賠率 {{ result.match1X2.impliedDraw ? (1 / result.match1X2.impliedDraw).toFixed(2) : '—' }}</div>
            <div>模型 {{ pct(result.match1X2.probabilityCalibratedDraw) }}</div>
            <div class="text-xs">去水 {{ pct(result.match1X2.marketDraw) }}</div>
            <div :class="evClass(result.match1X2.evDraw)">EV {{ evText(result.match1X2.evDraw) }}</div>
          </div>
          <div class="rounded-lg bg-stone-50 p-2">
            <div class="font-medium">客勝</div>
            <div class="text-xs text-stone-500">賠率 {{ result.match1X2.impliedAway ? (1 / result.match1X2.impliedAway).toFixed(2) : '—' }}</div>
            <div>模型 {{ pct(result.match1X2.probabilityCalibratedAway) }}</div>
            <div class="text-xs">去水 {{ pct(result.match1X2.marketAway) }}</div>
            <div :class="evClass(result.match1X2.evAway)">EV {{ evText(result.match1X2.evAway) }}</div>
          </div>
        </div>
        <p class="mt-2 text-xs text-stone-500">
          決策：{{ result.match1X2.decision.action === 'pass' ? '不投' : result.match1X2.decision.action === 'watch' ? '觀望' : '候選' }}｜{{ result.match1X2.decision.reason }}
        </p>
      </div>

      <OutcomeMarketCard v-if="result.totalGoals" title="大小球" :quote="result.totalGoals" />
      <OutcomeMarketCard v-if="result.goalsHandicap" title="讓球" :quote="result.goalsHandicap" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FootballDiscipline, QuoteResponse, FixtureSummary, StatusResponse, TeamOption } from '~~/shared/types'
import { fixturePresentMarkets, isTeamOption, type BetMarket } from '~~/shared/types'
import { disciplineLabelFull } from '~~/shared/sports'

type QuoteTab = 'fixtures' | 'form' | 'result'

const QUOTE_TABS: Array<{ id: QuoteTab, label: string }> = [
  { id: 'fixtures', label: '今日對局' },
  { id: 'form', label: '隊伍與賠率' },
  { id: 'result', label: '計算結果' },
]

useHead({ title: '足球對局估計' })

const { data: status } = await useAsyncData('football-model-status', () =>
  $fetch<StatusResponse>('/api/football/status')
)

type FootballFormState = {
  discipline: FootballDiscipline
  away: TeamOption | null
  home: TeamOption | null
  isHome: boolean
  tournament: string
  match1X2Home: string | number
  match1X2Draw: string | number
  match1X2Away: string | number
  totalLine: string | number
  totalOverOdds: string | number
  totalUnderOdds: string | number
  handicapHomeLine: string | number
  handicapAwayOdds: string | number
  handicapHomeOdds: string | number
}

const emptyForm = (): FootballFormState => ({
  discipline: 'FM',
  away: null,
  home: null,
  isHome: true,
  tournament: '',
  match1X2Home: '',
  match1X2Draw: '',
  match1X2Away: '',
  totalLine: '',
  totalOverOdds: '',
  totalUnderOdds: '',
  handicapHomeLine: '',
  handicapAwayOdds: '',
  handicapHomeOdds: '',
})

const form = reactive<FootballFormState>(emptyForm())
const result = ref<QuoteResponse | null>(null)
const errorMessage = ref('')
const activeTab = ref<QuoteTab>('fixtures')
const activeFixture = ref<FixtureSummary | null>(null)

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`

const evText = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—'
  const formatted = value.toFixed(3)
  return value > 0 ? `+${formatted}` : formatted
}

const evClass = (value: number | null | undefined) => {
  if (value === null || value === undefined) return 'text-stone-400'
  if (value > 0.05) return 'text-green-700 font-medium'
  if (value > 0) return 'text-green-600'
  return 'text-stone-500'
}

const showMarket = (market: BetMarket) =>
  !activeFixture.value || fixturePresentMarkets(activeFixture.value.odds).includes(market)

const ignoredMarkets = computed(() => activeFixture.value?.ignoredMarkets ?? [])

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

const read1X2Odds = (home: string | number, draw: string | number, away: string | number) => {
  if ([home, draw, away].every(isBlank)) return undefined
  const h = Number(home)
  const d = Number(draw)
  const a = Number(away)
  if (!(h > 1) || !(d > 1) || !(a > 1)) return null
  return { home: h, draw: d, away: a }
}

const readLineOdds = (lineText: string | number, firstText: string | number, secondText: string | number) => {
  if ([lineText, firstText, secondText].every(isBlank)) return undefined
  const line = Number(lineText)
  const first = Number(firstText)
  const second = Number(secondText)
  if (!Number.isFinite(line) || !(first > 1) || !(second > 1)) return null
  return { line, first, second }
}

const asTeam = (participant: FixtureSummary['away']) =>
  participant && isTeamOption(participant) ? participant : null

const handleSelectFixture = async (fixture: FixtureSummary) => {
  result.value = null
  activeFixture.value = fixture
  form.discipline = fixture.discipline === 'FW' ? 'FW' : 'FM'
  form.tournament = fixture.tournament
  form.isHome = fixture.isHome !== false
  await nextTick()
  form.away = asTeam(fixture.away)
  form.home = asTeam(fixture.home)
  form.match1X2Home = fixture.odds.match1X2?.home ?? ''
  form.match1X2Draw = fixture.odds.match1X2?.draw ?? ''
  form.match1X2Away = fixture.odds.match1X2?.away ?? ''
  form.totalLine = fixture.odds.totals?.line ?? ''
  form.totalOverOdds = fixture.odds.totals?.over ?? ''
  form.totalUnderOdds = fixture.odds.totals?.under ?? ''
  form.handicapHomeLine = fixture.odds.handicap?.homeLine ?? ''
  form.handicapAwayOdds = fixture.odds.handicap?.away ?? ''
  form.handicapHomeOdds = fixture.odds.handicap?.home ?? ''

  if (fixture.awayMatchStatus === 'pending' || fixture.homeMatchStatus === 'pending' || !form.away || !form.home) {
    errorMessage.value = '賠率已帶入。有隊伍標示「待確認」，請手動選擇資料庫隊伍後按計算（不會用譯名自動配對）。'
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

  const match1X2Odds = read1X2Odds(form.match1X2Home, form.match1X2Draw, form.match1X2Away)
  if (match1X2Odds === null) {
    errorMessage.value = '1X2 賠率要填三個，而且都要大於 1'
    activeTab.value = 'form'
    return
  }

  const totals = readLineOdds(form.totalLine, form.totalOverOdds, form.totalUnderOdds)
  const handicap = readLineOdds(form.handicapHomeLine, form.handicapAwayOdds, form.handicapHomeOdds)

  if (totals === null || handicap === null) {
    errorMessage.value = '有填的盤口要整組填齊，賠率大於 1'
    activeTab.value = 'form'
    return
  }

  try {
    const quote = await $fetch<QuoteResponse>('/api/football/quote', {
      method: 'POST',
      body: {
        discipline: form.discipline,
        awayTeamId: form.away.id,
        homeTeamId: form.home.id,
        isHome: form.isHome,
        tournament: form.tournament,
        match1X2Odds,
        totalOdds: totals ? { line: totals.line, over: totals.first, under: totals.second } : undefined,
        handicapOdds: handicap ? { homeLine: handicap.line, away: handicap.first, home: handicap.second } : undefined,
      },
    })
    result.value = quote
    activeTab.value = 'result'
    if (activeFixture.value) {
      void $fetch('/api/predictions/snapshot', {
        method: 'POST',
        body: { fixtureId: activeFixture.value.sportradarId, quote },
      }).catch(() => undefined)
    }
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '計算失敗')
    activeTab.value = 'form'
  }
}
</script>
