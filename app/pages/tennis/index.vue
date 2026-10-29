<template>
	<div>
		<h1 class="text-2xl font-semibold">網球對局估計</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
			在「今日對局」一鍵帶入運彩賽事，或到「選手與賠率」自己輸入。全場與第 1 盤分開估計；總局數、讓局、讓盤用每點模型推算。分數盤沒有真實盤口回測，最多觀望。
		</p>

		<p v-if="status && !status.ready" class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
			尚未完成回測。請先執行 <code>npm run update:data</code>，或等開發伺服器啟動後自動更新完成。
		</p>
		<ul v-if="status?.notes?.length" class="mt-4 space-y-1 rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
			<li v-for="note in status.notes" :key="note">{{ note }}</li>
		</ul>

		<div class="mt-6 flex flex-wrap gap-2 border-b border-stone-200" role="tablist" aria-label="計算步驟">
			<button
				v-for="(tab, index) in QUOTE_TABS"
				:id="`quote-tab-${tab.id}`"
				:key="tab.id"
				type="button"
				role="tab"
				class="-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-700 disabled:cursor-not-allowed disabled:opacity-40"
				:class="{
					'border-lime-800 text-lime-900': activeTab === tab.id,
					'border-transparent text-stone-500 hover:text-stone-800': activeTab !== tab.id
				}"
				:aria-selected="activeTab === tab.id"
				:aria-controls="`quote-panel-${tab.id}`"
				:tabindex="activeTab === tab.id ? 0 : -1"
				:disabled="!isTabEnabled(tab.id)"
				@click="handleSelectTab(tab.id)"
				@keydown="(event) => handleTabKeydown(event, index)"
			>
				{{ tab.label }}
			</button>
		</div>

		<div v-show="activeTab === 'fixtures'" id="quote-panel-fixtures" class="mt-4" role="tabpanel" aria-labelledby="quote-tab-fixtures">
			<FixtureList
				:active-id="activeFixture?.sportradarId ?? null"
				sport="tennis"
				endpoint="/api/tennis/fixtures"
				sync-path="/tennis/tsl-sync"
				@select="handleSelectFixture"
			/>
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
					<label
						class="cursor-pointer rounded-full border px-3 py-1.5 text-sm"
						:class="form.discipline === 'ATP' ? 'border-lime-900 bg-lime-900 text-white' : 'border-stone-300'"
					>
						<input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="ATP" />
						ATP
					</label>
					<label
						class="cursor-pointer rounded-full border px-3 py-1.5 text-sm"
						:class="form.discipline === 'WTA' ? 'border-lime-900 bg-lime-900 text-white' : 'border-stone-300'"
					>
						<input v-model="form.discipline" class="sr-only" type="radio" name="discipline" value="WTA" />
						WTA
					</label>
				</div>
			</fieldset>

			<label class="block min-w-0 text-sm">
				賽事名稱（用來判斷大滿貫五盤）
				<input v-model="form.tournament" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" type="text" aria-label="賽事名稱" />
			</label>

			<div class="grid gap-4 md:grid-cols-2">
				<PlayerField v-model="form.away" class="min-w-0" label="客隊" :discipline="form.discipline" endpoint="/api/tennis/players" />
				<PlayerField v-model="form.home" class="min-w-0" label="主隊" :discipline="form.discipline" endpoint="/api/tennis/players" />
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<fieldset v-if="showMarket('match')" class="min-w-0">
					<legend class="text-sm font-medium">全場不讓分賠率</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label class="block text-xs text-stone-500"
							>客隊<input
								v-model="form.matchAwayOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>主隊<input
								v-model="form.matchHomeOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
				<fieldset v-if="showMarket('set1')" class="min-w-0">
					<legend class="text-sm font-medium">第 1 盤不讓分賠率</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label class="block text-xs text-stone-500"
							>客隊<input
								v-model="form.set1AwayOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>主隊<input
								v-model="form.set1HomeOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<fieldset v-if="showMarket('totals')" class="min-w-0">
					<legend class="text-sm font-medium">[總局數]大小</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class="block text-xs text-stone-500"
							>盤口線<input
								v-model="form.totalLine"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								step="1"
								placeholder="22.5"
						/></label>
						<label class="block text-xs text-stone-500"
							>大<input
								v-model="form.totalOverOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>小<input
								v-model="form.totalUnderOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
				<fieldset v-if="showMarket('handicap')" class="min-w-0">
					<legend class="text-sm font-medium">[總局數]讓分（照運彩標題）</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class="block text-xs text-stone-500"
							>主隊讓分<input
								v-model="form.handicapHomeLine"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								step="1"
								placeholder="-3.5"
						/></label>
						<label class="block text-xs text-stone-500"
							>客隊<input
								v-model="form.handicapAwayOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>主隊<input
								v-model="form.handicapHomeOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<fieldset v-if="showMarket('setHandicap')" class="min-w-0">
					<legend class="text-sm font-medium">讓盤</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class="block text-xs text-stone-500"
							>主隊讓盤<input
								v-model="form.setHandicapHomeLine"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								step="1"
								placeholder="-1.5"
						/></label>
						<label class="block text-xs text-stone-500"
							>客隊<input
								v-model="form.setHandicapAwayOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>主隊<input
								v-model="form.setHandicapHomeOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
				<fieldset v-if="showMarket('set1Totals')" class="min-w-0">
					<legend class="text-sm font-medium">[第1盤]大小</legend>
					<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class="block text-xs text-stone-500"
							>盤口線<input
								v-model="form.set1TotalLine"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								step="1"
								placeholder="9.5"
						/></label>
						<label class="block text-xs text-stone-500"
							>大<input
								v-model="form.set1TotalOverOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
						<label class="block text-xs text-stone-500"
							>小<input
								v-model="form.set1TotalUnderOdds"
								class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
								type="number"
								min="1.01"
								step="0.01"
						/></label>
					</div>
				</fieldset>
			</div>

			<fieldset v-if="showMarket('set1Handicap')" class="min-w-0">
				<legend class="text-sm font-medium">[第1盤]讓分</legend>
				<div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
					<label class="block text-xs text-stone-500"
						>主隊讓分<input v-model="form.set1HandicapHomeLine" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" type="number" step="1"
					/></label>
					<label class="block text-xs text-stone-500"
						>客隊<input
							v-model="form.set1HandicapAwayOdds"
							class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
							type="number"
							min="1.01"
							step="0.01"
					/></label>
					<label class="block text-xs text-stone-500"
						>主隊<input
							v-model="form.set1HandicapHomeOdds"
							class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
							type="number"
							min="1.01"
							step="0.01"
					/></label>
				</div>
			</fieldset>

			<fieldset v-if="showMarket('setCount')" class="min-w-0">
				<legend class="text-sm font-medium">正確總盤數</legend>
				<div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<label v-for="sets in setCountKeys" :key="sets" class="block text-xs text-stone-500">
						{{ sets }} 盤
						<input
							v-model="form.setCountOdds[sets]"
							class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
							type="number"
							min="1.01"
							step="0.01"
						/>
					</label>
				</div>
			</fieldset>

			<fieldset v-if="showMarket('correctScore')" class="min-w-0">
				<legend class="text-sm font-medium">正確比數（客:主）</legend>
				<div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<label v-for="score in scoreKeys" :key="score" class="block text-xs text-stone-500">
						{{ score }}
						<input
							v-model="form.correctScoreOdds[score]"
							class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
							type="number"
							min="1.01"
							step="0.01"
						/>
					</label>
				</div>
			</fieldset>

			<p v-if="(activeFixture?.ignoredMarkets ?? []).length" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
				運彩還有這些盤，目前沒有模型：{{ activeFixture?.ignoredMarkets?.join("、") }}
			</p>
			<button type="submit" class="rounded-lg bg-lime-800 px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-lime-700">
				計算
			</button>
			<p v-if="errorMessage" class="text-sm text-rose-700" role="alert">{{ errorMessage }}</p>
		</form>

		<div v-if="result" v-show="activeTab === 'result'" id="quote-panel-result" class="mt-4 space-y-4" role="tabpanel" aria-labelledby="quote-tab-result">
			<div class="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-600">
				<p class="wrap-break-word text-base font-semibold text-stone-900">
					{{ result.away.name }} 對 {{ result.home.name }}
					<span class="ml-1 text-xs font-normal text-stone-500">{{ disciplineLabel[result.discipline] }}</span>
				</p>
				<p>資料截至 {{ result.dataThrough }}。報價日 {{ result.asOf }}。模型 {{ result.modelVersion }}。</p>
			</div>
			<ul
				v-if="(result.warnings ?? []).length > 0"
				class="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
			>
				<li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
			</ul>
			<p v-if="slipMessage" class="rounded-xl bg-lime-50 px-4 py-3 text-sm text-lime-900" role="status">
				{{ slipMessage }}
				<NuxtLink to="/tennis/bets" class="ml-1 underline">看投注紀錄</NuxtLink>
			</p>
			<div class="grid gap-4 md:grid-cols-2">
				<MarketCard
					title="全場不讓分"
					:away-name="result.away.name"
					:home-name="result.home.name"
					:quote="result.matchWinner"
					@slip="(side) => handleSlipWinner('match', side)"
				/>
				<MarketCard
					title="第 1 盤不讓分"
					:away-name="result.away.name"
					:home-name="result.home.name"
					:quote="result.set1Winner"
					@slip="(side) => handleSlipWinner('set1', side)"
				/>
				<OutcomeMarketCard
					v-if="result.totalPoints"
					title="[總局數]大小"
					:quote="result.totalPoints"
					@slip="(outcome) => handleSlipOutcome('totals', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.pointsHandicap"
					title="[總局數]讓分"
					:quote="result.pointsHandicap"
					@slip="(outcome) => handleSlipOutcome('handicap', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.setHandicap"
					title="讓盤"
					:quote="result.setHandicap"
					@slip="(outcome) => handleSlipOutcome('setHandicap', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.set1TotalPoints"
					title="[第1盤]大小"
					:quote="result.set1TotalPoints"
					@slip="(outcome) => handleSlipOutcome('set1Totals', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.set1PointsHandicap"
					title="[第1盤]讓分"
					:quote="result.set1PointsHandicap"
					@slip="(outcome) => handleSlipOutcome('set1Handicap', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.setCount"
					title="正確總盤數"
					:quote="result.setCount"
					@slip="(outcome) => handleSlipOutcome('setCount', outcome)"
				/>
				<OutcomeMarketCard
					v-if="result.correctScore"
					class="md:col-span-2"
					title="正確比數（客:主）"
					:quote="result.correctScore"
					@slip="(outcome) => handleSlipOutcome('correctScore', outcome)"
				/>
			</div>
			<p class="text-sm leading-6 text-stone-600">候選不是投注指示。分數盤最多觀望。</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { BetMarket, FixtureSummary, PlayerOption, QuoteResponse, StatusResponse, TennisDiscipline } from "~~/shared/types";
import { fixturePresentMarkets, TENNIS_BO3_CORRECT_SCORES, TENNIS_BO5_CORRECT_SCORES } from "~~/shared/types";
import { disciplineLabel, tennisBestOf } from "~~/shared/sports";
import { isHalfLine } from "~~/shared/decision";

type QuoteTab = "fixtures" | "form" | "result";
const QUOTE_TABS: Array<{ id: QuoteTab; label: string }> = [
	{ id: "fixtures", label: "今日對局" },
	{ id: "form", label: "選手與賠率" },
	{ id: "result", label: "計算結果" }
];

useHead({ title: "網球對局估計" });

const { data: status } = await useAsyncData("tennis-model-status", () => $fetch<StatusResponse>("/api/tennis/status"));

type TennisForm = {
	discipline: TennisDiscipline;
	tournament: string;
	away: PlayerOption | null;
	home: PlayerOption | null;
	matchAwayOdds: string | number;
	matchHomeOdds: string | number;
	set1AwayOdds: string | number;
	set1HomeOdds: string | number;
	totalLine: string | number;
	totalOverOdds: string | number;
	totalUnderOdds: string | number;
	handicapHomeLine: string | number;
	handicapAwayOdds: string | number;
	handicapHomeOdds: string | number;
	setHandicapHomeLine: string | number;
	setHandicapAwayOdds: string | number;
	setHandicapHomeOdds: string | number;
	set1TotalLine: string | number;
	set1TotalOverOdds: string | number;
	set1TotalUnderOdds: string | number;
	set1HandicapHomeLine: string | number;
	set1HandicapAwayOdds: string | number;
	set1HandicapHomeOdds: string | number;
	setCountOdds: Record<string, string | number>;
	correctScoreOdds: Record<string, string | number>;
};

const emptyForm = (): TennisForm => ({
	discipline: "ATP",
	tournament: "",
	away: null,
	home: null,
	matchAwayOdds: "",
	matchHomeOdds: "",
	set1AwayOdds: "",
	set1HomeOdds: "",
	totalLine: "",
	totalOverOdds: "",
	totalUnderOdds: "",
	handicapHomeLine: "",
	handicapAwayOdds: "",
	handicapHomeOdds: "",
	setHandicapHomeLine: "",
	setHandicapAwayOdds: "",
	setHandicapHomeOdds: "",
	set1TotalLine: "",
	set1TotalOverOdds: "",
	set1TotalUnderOdds: "",
	set1HandicapHomeLine: "",
	set1HandicapAwayOdds: "",
	set1HandicapHomeOdds: "",
	setCountOdds: { "2": "", "3": "", "4": "", "5": "" },
	correctScoreOdds: Object.fromEntries([...TENNIS_BO3_CORRECT_SCORES, ...TENNIS_BO5_CORRECT_SCORES].map((score) => [score, ""]))
});

const form = reactive<TennisForm>(emptyForm());
const result = ref<QuoteResponse | null>(null);
const errorMessage = ref("");
const activeTab = ref<QuoteTab>("fixtures");
const activeFixture = ref<FixtureSummary | null>(null);
const {
	slipMessage,
	handleSlipWinner,
	handleSlipOutcome
} = useQuoteBetActions(result, activeFixture);

const bestOf = computed(() => tennisBestOf(form.tournament, form.discipline));
const scoreKeys = computed(() => (bestOf.value === 5 ? TENNIS_BO5_CORRECT_SCORES : TENNIS_BO3_CORRECT_SCORES));
const setCountKeys = computed(() => (bestOf.value === 5 ? ["3", "4", "5"] : ["2", "3"]));

const showMarket = (market: BetMarket) => !activeFixture.value || fixturePresentMarkets(activeFixture.value.odds).includes(market);

const isTabEnabled = (tab: QuoteTab) => tab !== "result" || result.value !== null;
const handleSelectTab = (tab: QuoteTab) => {
	if (!isTabEnabled(tab)) return;
	activeTab.value = tab;
};
const handleTabKeydown = (event: KeyboardEvent, index: number) => {
	const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
	const step = steps[event.key];
	if (!step) return;
	event.preventDefault();
	const enabledTabs = QUOTE_TABS.filter((tab) => isTabEnabled(tab.id));
	const currentIndex = enabledTabs.findIndex((tab) => tab.id === QUOTE_TABS[index]?.id);
	const next = enabledTabs[(currentIndex + step + enabledTabs.length) % enabledTabs.length];
	if (!next) return;
	handleSelectTab(next.id);
};

const isBlank = (value: string | number) => String(value).trim() === "";
const readOdds = (awayText: string | number, homeText: string | number) => {
	if (isBlank(awayText) && isBlank(homeText)) return undefined;
	const away = Number(awayText);
	const home = Number(homeText);
	if (!(away > 1) || !(home > 1)) return null;
	return { away, home };
};
const readLineOdds = (lineText: string | number, firstText: string | number, secondText: string | number) => {
	if ([lineText, firstText, secondText].every(isBlank)) return undefined;
	const line = Number(lineText);
	const first = Number(firstText);
	const second = Number(secondText);
	if (!isHalfLine(line) || !(first > 1) || !(second > 1)) return null;
	return { line, first, second };
};

const handleSelectFixture = async (fixture: FixtureSummary) => {
	result.value = null;
	activeFixture.value = fixture;
	form.discipline = fixture.discipline === "WTA" ? "WTA" : "ATP";
	form.tournament = fixture.tournament;
	await nextTick();
	form.away = fixture.away && !("homeAdvantage" in fixture.away) ? fixture.away : null;
	form.home = fixture.home && !("homeAdvantage" in fixture.home) ? fixture.home : null;
	form.matchAwayOdds = fixture.odds.match?.away ?? "";
	form.matchHomeOdds = fixture.odds.match?.home ?? "";
	form.set1AwayOdds = fixture.odds.set1?.away ?? "";
	form.set1HomeOdds = fixture.odds.set1?.home ?? "";
	form.totalLine = fixture.odds.totals?.line ?? "";
	form.totalOverOdds = fixture.odds.totals?.over ?? "";
	form.totalUnderOdds = fixture.odds.totals?.under ?? "";
	form.handicapHomeLine = fixture.odds.handicap?.homeLine ?? "";
	form.handicapAwayOdds = fixture.odds.handicap?.away ?? "";
	form.handicapHomeOdds = fixture.odds.handicap?.home ?? "";
	form.setHandicapHomeLine = fixture.odds.setHandicap?.homeLine ?? "";
	form.setHandicapAwayOdds = fixture.odds.setHandicap?.away ?? "";
	form.setHandicapHomeOdds = fixture.odds.setHandicap?.home ?? "";
	form.set1TotalLine = fixture.odds.set1Totals?.line ?? "";
	form.set1TotalOverOdds = fixture.odds.set1Totals?.over ?? "";
	form.set1TotalUnderOdds = fixture.odds.set1Totals?.under ?? "";
	form.set1HandicapHomeLine = fixture.odds.set1Handicap?.homeLine ?? "";
	form.set1HandicapAwayOdds = fixture.odds.set1Handicap?.away ?? "";
	form.set1HandicapHomeOdds = fixture.odds.set1Handicap?.home ?? "";
	form.setCountOdds = Object.fromEntries(["2", "3", "4", "5"].map((key) => [key, fixture.odds.setCount?.[key] ?? ""]));
	form.correctScoreOdds = {
		...emptyForm().correctScoreOdds,
		...(fixture.odds.correctScore ?? {})
	};
	if (!form.away || !form.home) {
		errorMessage.value = "賠率已帶入，但有選手對不上資料庫，請手動選擇後按計算";
		activeTab.value = "form";
		return;
	}
	await handleSubmit();
};

const handleSubmit = async () => {
	errorMessage.value = "";
	if (!form.away || !form.home) {
		errorMessage.value = "請從清單選擇客隊與主隊";
		activeTab.value = "form";
		return;
	}
	const matchOdds = readOdds(form.matchAwayOdds, form.matchHomeOdds);
	const set1Odds = readOdds(form.set1AwayOdds, form.set1HomeOdds);
	if (matchOdds === null || set1Odds === null) {
		errorMessage.value = "同一個玩法要填雙方賠率，而且都要大於 1";
		activeTab.value = "form";
		return;
	}
	const totals = readLineOdds(form.totalLine, form.totalOverOdds, form.totalUnderOdds);
	const handicap = readLineOdds(form.handicapHomeLine, form.handicapAwayOdds, form.handicapHomeOdds);
	const setHandicap = readLineOdds(form.setHandicapHomeLine, form.setHandicapAwayOdds, form.setHandicapHomeOdds);
	const set1Totals = readLineOdds(form.set1TotalLine, form.set1TotalOverOdds, form.set1TotalUnderOdds);
	const set1Handicap = readLineOdds(form.set1HandicapHomeLine, form.set1HandicapAwayOdds, form.set1HandicapHomeOdds);
	if (totals === null || handicap === null || setHandicap === null || set1Totals === null || set1Handicap === null) {
		errorMessage.value = "有填的盤口要整組填齊，賠率大於 1，盤口線要是 .5";
		activeTab.value = "form";
		return;
	}
	const filledScores = scoreKeys.value.flatMap((score) => {
		const odds = Number(form.correctScoreOdds[score]);
		return Number.isFinite(odds) && odds > 1 ? [[score, odds] as const] : [];
	});
	const keys = setCountKeys.value;
	const setCountTouched = keys.some((key) => !isBlank(form.setCountOdds[key] ?? ""));
	const filledSetCounts = keys.flatMap((key) => {
		const odds = Number(form.setCountOdds[key]);
		return Number.isFinite(odds) && odds > 1 ? [[key, odds] as const] : [];
	});
	if (setCountTouched && filledSetCounts.length !== keys.length) {
		errorMessage.value = "正確總盤數要整組填齊，賠率大於 1";
		activeTab.value = "form";
		return;
	}
	try {
		result.value = await $fetch<QuoteResponse>("/api/tennis/quote", {
			method: "POST",
			body: {
				discipline: form.discipline,
				awayPlayerId: form.away.id,
				homePlayerId: form.home.id,
				tournament: form.tournament,
				matchOdds,
				set1Odds,
				totalOdds: totals ? { line: totals.line, over: totals.first, under: totals.second } : undefined,
				handicapOdds: handicap ? { awayLine: -handicap.line, away: handicap.first, home: handicap.second } : undefined,
				setHandicapOdds: setHandicap ? { awayLine: -setHandicap.line, away: setHandicap.first, home: setHandicap.second } : undefined,
				set1TotalOdds: set1Totals ? { line: set1Totals.line, over: set1Totals.first, under: set1Totals.second } : undefined,
				set1HandicapOdds: set1Handicap ? { awayLine: -set1Handicap.line, away: set1Handicap.first, home: set1Handicap.second } : undefined,
				setCountOdds: filledSetCounts.length === keys.length ? Object.fromEntries(filledSetCounts) : undefined,
				correctScoreOdds: filledScores.length === scoreKeys.value.length ? Object.fromEntries(filledScores) : undefined
			}
		});
		activeTab.value = "result";
	} catch (error) {
		errorMessage.value = apiErrorMessage(error, "計算失敗");
		activeTab.value = "form";
	}
};
</script>
