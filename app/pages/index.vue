<template>
  <div>
    <h1 class="text-2xl font-semibold">依投注標的計算</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
      在「今日對局」一鍵帶入運彩賽事，或到「選手與賠率」自己輸入。全場與第一局分開估計；總分大小、總分讓分、正確比數用每球得分模型推算。結果頁可以記錄實際下注。
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
        class="-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        :class="{
          'border-emerald-800 text-emerald-900': activeTab === tab.id,
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
      <FixtureList :active-id="activeFixture?.sportradarId ?? null" @select="handleSelectFixture" />
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
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'MS' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="MS">
            男單
          </label>
          <label class="cursor-pointer rounded-full border px-3 py-1.5 text-sm" :class="form.discipline === 'WS' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'">
            <input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="WS">
            女單
          </label>
        </div>
      </fieldset>

      <div class="grid gap-4 md:grid-cols-2">
        <PlayerField v-model="form.away" class="min-w-0" label="客隊" :discipline="form.discipline" />
        <PlayerField v-model="form.home" class="min-w-0" label="主隊" :discipline="form.discipline" />
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">全場不讓分賠率</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block min-w-0 text-xs text-stone-500" for="match-away">
              客隊
              <input id="match-away" v-model="form.matchAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="全場客隊十進位賠率">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="match-home">
              主隊
              <input id="match-home" v-model="form.matchHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="全場主隊十進位賠率">
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">第一局不讓分賠率</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block min-w-0 text-xs text-stone-500" for="game-away">
              客隊
              <input id="game-away" v-model="form.gameAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="第一局客隊十進位賠率">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="game-home">
              主隊
              <input id="game-home" v-model="form.gameHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="第一局主隊十進位賠率">
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
              <input id="total-line" v-model="form.totalLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="0.5" step="1" placeholder="80.5" inputmode="decimal" aria-label="總分大小盤口線，需為 .5">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="total-over">
              大
              <input id="total-over" v-model="form.totalOverOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="總分大的十進位賠率">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="total-under">
              小
              <input id="total-under" v-model="form.totalUnderOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="總分小的十進位賠率">
            </label>
          </div>
        </fieldset>
        <fieldset class="min-w-0">
          <legend class="text-sm font-medium">[總分]讓分</legend>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-line">
              盤口線（照運彩標題）
              <input id="handicap-line" v-model="form.handicapHomeLine" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="-99.5" step="1" placeholder="-8.5" inputmode="decimal" aria-label="總分讓分盤口線，照運彩標題填，也就是主隊讓分，需為 .5" aria-describedby="handicap-preview">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-away">
              客隊
              <input id="handicap-away" v-model="form.handicapAwayOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="總分讓分客隊十進位賠率">
            </label>
            <label class="block min-w-0 text-xs text-stone-500" for="handicap-home">
              主隊
              <input id="handicap-home" v-model="form.handicapHomeOdds" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" aria-label="總分讓分主隊十進位賠率">
            </label>
          </div>
          <p id="handicap-preview" class="mt-2 text-xs wrap-break-word text-stone-500" aria-live="polite">
            {{ handicapPreview }}
          </p>
        </fieldset>
      </div>

      <fieldset class="min-w-0">
        <legend class="text-sm font-medium">正確比數（客:主）</legend>
        <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label
            v-for="score in CORRECT_SCORES"
            :key="score"
            class="block min-w-0 text-xs text-stone-500"
            :for="`score-${score}`"
          >
            {{ score }}
            <input :id="`score-${score}`" v-model="form.correctScoreOdds[score]" class="mt-1 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" type="number" min="1.01" step="0.01" inputmode="decimal" :aria-label="`正確比數客 ${score} 主的十進位賠率`">
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        class="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
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
      aria-live="polite"
    >
      <div class="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-600">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="wrap-break-word text-base font-semibold text-stone-900">
            {{ result.away.name }} 對 {{ result.home.name }}
            <span class="ml-1 text-xs font-normal text-stone-500">{{ disciplineLabel[result.discipline] }}</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              @click="handleSelectTab('form')"
            >
              修改賠率
            </button>
            <button
              type="button"
              class="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              @click="handleSelectTab('fixtures')"
            >
              選其他對局
            </button>
          </div>
        </div>
        <p>資料截至 {{ result.dataThrough }}。報價日 {{ result.asOf }}。模型 {{ result.modelVersion }}。</p>
        <p>客隊最後出賽 {{ result.away.lastPlayedOn ?? '—' }}，{{ result.away.matchCount }} 場。主隊最後出賽 {{ result.home.lastPlayedOn ?? '—' }}，{{ result.home.matchCount }} 場。</p>
        <p class="break-all text-xs leading-5 text-stone-500">來源 {{ result.sourceUrl }}</p>
      </div>
      <ul v-if="(result.warnings ?? []).length > 0" class="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" aria-label="估計限制">
        <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <p v-if="savedBetMessage" class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
        {{ savedBetMessage }}
        <NuxtLink to="/bets" class="ml-1 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700">看投注紀錄</NuxtLink>
      </p>
      <div class="grid gap-4 md:grid-cols-2">
        <MarketCard
          title="全場不讓分"
          :away-name="result.away.name"
          :home-name="result.home.name"
          :quote="result.matchWinner"
          @record="side => handleRecordWinner('match', side)"
        />
        <MarketCard
          title="第一局不讓分"
          :away-name="result.away.name"
          :home-name="result.home.name"
          :quote="result.set1Winner"
          @record="side => handleRecordWinner('set1', side)"
        />
        <OutcomeMarketCard v-if="result.totalPoints" title="[總分]大小" :quote="result.totalPoints" @record="outcome => handleRecordOutcome('totals', outcome)" />
        <OutcomeMarketCard v-if="result.pointsHandicap" title="[總分]讓分" :quote="result.pointsHandicap" @record="outcome => handleRecordOutcome('handicap', outcome)" />
        <OutcomeMarketCard v-if="result.correctScore" class="md:col-span-2" title="正確比數（客:主）" :quote="result.correctScore" @record="outcome => handleRecordOutcome('correctScore', outcome)" />
      </div>
      <p v-if="hasOdds" class="text-sm leading-6 text-stone-600">
        <span v-if="candidateLabels.length > 0">候選：{{ candidateLabels.join('、') }}。</span>
        <span v-else>沒有候選。</span>
        不投是校準期望值為負；觀望是算式為正但優勢太薄或資料不夠。候選不是投注指示。
      </p>
    </div>

    <BetDialog :draft="betDraft" @close="handleCloseBetDialog" @saved="handleBetSaved" />
  </div>
</template>

<script setup lang="ts">
import {
  betMarketLabel,
  CORRECT_SCORES,
  type BetDraft,
  type BetMarket,
  type BetRecord,
  type CorrectScore,
  type FixtureSummary,
  type MarketQuote,
  type MarketSide,
  type MultiMarketQuote,
  type OutcomeQuote,
  type QuoteResponse,
  type StatusResponse,
} from '~~/shared/types'
import { isHalfLine } from '~~/shared/decision'

type QuoteTab = 'fixtures' | 'form' | 'result'

const QUOTE_TABS: Array<{ id: QuoteTab, label: string }> = [
  { id: 'fixtures', label: '今日對局' },
  { id: 'form', label: '選手與賠率' },
  { id: 'result', label: '計算結果' },
]

useHead({ title: '羽球對局估計' })

const { data: status } = await useAsyncData('model-status', () => $fetch<StatusResponse>('/api/status'))
const form = reactive<QuoteFormState>(emptyQuoteForm())
const result = ref<QuoteResponse | null>(null)
const errorMessage = ref('')
const activeTab = ref<QuoteTab>('fixtures')
const activeFixture = ref<FixtureSummary | null>(null)
const betDraft = ref<BetDraft | null>(null)
const savedBetMessage = ref('')

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

const multiMarkets = (quote: QuoteResponse) => [
  { title: '總分大小', market: quote.totalPoints },
  { title: '總分讓分', market: quote.pointsHandicap },
  { title: '正確比數', market: quote.correctScore },
].flatMap(row => (row.market ? [{ title: row.title, market: row.market }] : []))

const winnerMarkets = (quote: QuoteResponse) => [
  { title: '全場', market: quote.matchWinner },
  { title: '第一局', market: quote.set1Winner },
]

const hasWinnerOdds = (market: MarketQuote) => market.evAway !== null

const hasOutcomeOdds = (market: MultiMarketQuote) => market.outcomes.some(outcome => outcome.ev !== null)

const hasOdds = computed(() => {
  const quote = result.value
  if (!quote) return false
  return winnerMarkets(quote).some(row => hasWinnerOdds(row.market))
    || multiMarkets(quote).some(row => hasOutcomeOdds(row.market))
})

const candidatesOf = (quote: QuoteResponse) => {
  const winners = winnerMarkets(quote).flatMap((row) => {
    if (row.market.decision.action !== 'candidate' || !row.market.decision.side) return []
    const name = row.market.decision.side === 'away' ? quote.away.name : quote.home.name
    return [`${row.title} ${name}`]
  })
  const outcomes = multiMarkets(quote).flatMap((row) => {
    if (row.market.decision.action !== 'candidate') return []
    const outcome = row.market.outcomes.find(item => item.key === row.market.decision.outcomeKey)
    return outcome ? [`${row.title} ${outcome.label}`] : []
  })
  return [...winners, ...outcomes]
}

const candidateLabels = computed(() => (result.value ? candidatesOf(result.value) : []))

const isBlank = (value: InputValue) => String(value).trim() === ''

const readNumbers = (values: InputValue[]) => {
  if (values.every(isBlank)) return undefined
  if (values.some(isBlank)) return null
  const numbers = values.map(Number)
  return numbers.every(Number.isFinite) ? numbers : null
}

const readOdds = (awayText: InputValue, homeText: InputValue) => {
  const numbers = readNumbers([awayText, homeText])
  if (!numbers) return numbers
  const [awayOdds = 0, homeOdds = 0] = numbers
  if (!(awayOdds > 1) || !(homeOdds > 1)) return null
  return { away: awayOdds, home: homeOdds }
}

const readLineOdds = (lineText: InputValue, firstText: InputValue, secondText: InputValue) => {
  const numbers = readNumbers([lineText, firstText, secondText])
  if (!numbers) return numbers
  const [line = 0, first = 0, second = 0] = numbers
  if (!isHalfLine(line) || !(first > 1) || !(second > 1)) return null
  return { line, first, second }
}

const readTotalOdds = () => {
  const parsed = readLineOdds(form.totalLine, form.totalOverOdds, form.totalUnderOdds)
  if (!parsed) return parsed
  if (parsed.line <= 0) return null
  return { line: parsed.line, over: parsed.first, under: parsed.second }
}

const readHandicapOdds = () => {
  const parsed = readLineOdds(form.handicapHomeLine, form.handicapAwayOdds, form.handicapHomeOdds)
  if (!parsed) return parsed
  return { awayLine: -parsed.line, away: parsed.first, home: parsed.second }
}

const handicapPreview = computed(() => {
  const homeLine = Number(form.handicapHomeLine)
  if (isBlank(form.handicapHomeLine) || !isHalfLine(homeLine)) return '運彩標題的數字就是主隊讓分，例如標題 -8.5 代表主隊 -8.5、客隊 +8.5。'
  const awayName = form.away?.name ?? '客隊'
  const homeName = form.home?.name ?? '主隊'
  return `對照運彩按鈕：${awayName} ${formatSigned(-homeLine)}、${homeName} ${formatSigned(homeLine)}`
})

const readCorrectScoreOdds = () => {
  const numbers = readNumbers(CORRECT_SCORES.map(score => form.correctScoreOdds[score]))
  if (!numbers) return numbers
  if (!numbers.every(value => value > 1)) return null
  return Object.fromEntries(CORRECT_SCORES.map((score, index) => [score, numbers[index]])) as Record<CorrectScore, number>
}

const restoreForm = async (saved: QuoteFormState) => {
  form.discipline = saved.discipline
  await nextTick()
  Object.assign(form, saved)
}

const fixtureForm = (fixture: FixtureSummary): QuoteFormState => {
  const { match, set1, totals, handicap, correctScore } = fixture.odds
  const empty = emptyQuoteForm()
  return {
    ...empty,
    discipline: fixture.discipline,
    away: fixture.away,
    home: fixture.home,
    matchAwayOdds: match?.away ?? '',
    matchHomeOdds: match?.home ?? '',
    gameAwayOdds: set1?.away ?? '',
    gameHomeOdds: set1?.home ?? '',
    totalLine: totals?.line ?? '',
    totalOverOdds: totals?.over ?? '',
    totalUnderOdds: totals?.under ?? '',
    handicapHomeLine: handicap?.homeLine ?? '',
    handicapAwayOdds: handicap?.away ?? '',
    handicapHomeOdds: handicap?.home ?? '',
    correctScoreOdds: correctScore ? { ...correctScore } : empty.correctScoreOdds,
  }
}

const handleSelectFixture = async (fixture: FixtureSummary) => {
  savedBetMessage.value = ''
  result.value = null
  activeFixture.value = fixture
  await restoreForm(fixtureForm(fixture))
  if (!fixture.away || !fixture.home) {
    errorMessage.value = '賠率已帶入，但有選手對不上資料庫，請手動選擇後按計算'
    activeTab.value = 'form'
    return
  }
  await handleSubmit()
}

const betFixtureId = (quote: QuoteResponse) => {
  const fixture = activeFixture.value
  if (!fixture || fixture.discipline !== quote.discipline) return null
  if (fixture.away && fixture.away.id !== quote.away.id) return null
  if (fixture.home && fixture.home.id !== quote.home.id) return null
  return fixture.sportradarId
}

const betBase = (quote: QuoteResponse) => {
  const fixtureId = betFixtureId(quote)
  return {
    fixtureId,
    sport: quote.sport,
    discipline: quote.discipline,
    awayName: quote.away.name,
    homeName: quote.home.name,
    startsAt: fixtureId === null ? null : activeFixture.value?.startsAt ?? null,
    modelVersion: quote.modelVersion,
  }
}

const oddsFromImplied = (implied: number) => Math.round((1 / implied) * 1000) / 1000

const openBetDraft = (draft: BetDraft) => {
  savedBetMessage.value = ''
  betDraft.value = draft
}

const handleRecordWinner = (market: 'match' | 'set1', side: MarketSide) => {
  const quote = result.value
  if (!quote) return
  const marketQuote = market === 'match' ? quote.matchWinner : quote.set1Winner
  const implied = side === 'away' ? marketQuote.impliedAway : marketQuote.impliedHome
  if (implied === null) return
  const decision = marketQuote.decision
  openBetDraft({
    ...betBase(quote),
    market,
    outcomeKey: side,
    outcomeLabel: side === 'away' ? quote.away.name : quote.home.name,
    line: null,
    odds: oddsFromImplied(implied),
    probability: side === 'away' ? marketQuote.probabilityCalibratedAway : marketQuote.probabilityCalibratedHome,
    ev: side === 'away' ? marketQuote.evAway : marketQuote.evHome,
    action: decision.side === side ? decision.action : 'pass',
  })
}

const handleRecordOutcome = (market: Exclude<BetMarket, 'match' | 'set1'>, outcome: OutcomeQuote) => {
  const quote = result.value
  if (!quote || outcome.odds === null) return
  const marketQuote = { totals: quote.totalPoints, handicap: quote.pointsHandicap, correctScore: quote.correctScore }[market]
  if (!marketQuote) return
  const decision = marketQuote.decision
  openBetDraft({
    ...betBase(quote),
    market,
    outcomeKey: outcome.key,
    outcomeLabel: outcome.label,
    line: market === 'correctScore' ? null : marketQuote.line,
    odds: outcome.odds,
    probability: outcome.probabilityCalibrated,
    ev: outcome.ev,
    action: decision.outcomeKey === outcome.key ? decision.action : 'pass',
  })
}

const handleCloseBetDialog = () => {
  betDraft.value = null
}

const handleBetSaved = (bet: BetRecord) => {
  betDraft.value = null
  savedBetMessage.value = `已記錄 ${betMarketLabel[bet.market]} ${bet.outcomeLabel}，賠率 ${bet.odds}，金額 ${bet.stake}。`
}

const submitQuote = async () => {
  const { away, home } = form
  if (!away || !home) return '請從清單選擇客隊與主隊'
  if (away.id === home.id) return '請選擇兩位不同選手'
  const matchOdds = readOdds(form.matchAwayOdds, form.matchHomeOdds)
  const game1Odds = readOdds(form.gameAwayOdds, form.gameHomeOdds)
  if (matchOdds === null || game1Odds === null) return '同一個玩法要填雙方賠率，而且都要大於 1'
  const totalOdds = readTotalOdds()
  const handicapOdds = readHandicapOdds()
  const scoreOdds = readCorrectScoreOdds()
  if (totalOdds === null || handicapOdds === null || scoreOdds === null) return '總分、讓分、正確比數有填的話要整組填齊，賠率要大於 1，盤口線要是 .5（例如 80.5、-4.5）'

  try {
    const quote = await $fetch<QuoteResponse>('/api/quote', {
      method: 'POST',
      body: {
        discipline: form.discipline,
        awayPlayerId: away.id,
        homePlayerId: home.id,
        matchOdds,
        game1Odds,
        totalOdds,
        handicapOdds,
        correctScoreOdds: scoreOdds,
      },
    })
    result.value = quote
    return ''
  } catch (error) {
    return apiErrorMessage(error, '計算失敗')
  }
}

const handleSubmit = async () => {
  savedBetMessage.value = ''
  errorMessage.value = await submitQuote()
  activeTab.value = errorMessage.value ? 'form' : 'result'
}
</script>
