<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <NuxtLink to="/draw" class="text-sm text-stone-500 hover:text-stone-700">← 返回選擇運動</NuxtLink>
        <h1 class="mt-1 text-2xl font-semibold">羽球抽籤分組</h1>
      </div>
      <div v-if="step === 'result'" class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          @click="handleReshuffle"
        >
          重新抽籤
        </button>
        <button
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          @click="handleReset"
        >
          重新開始
        </button>
      </div>
    </div>

    <form v-if="step === 'setup'" class="mt-6 space-y-6 rounded-2xl border border-stone-200 bg-white p-6" @submit.prevent="handleGenerate">
      <fieldset>
        <legend class="text-base font-medium">比賽模式</legend>
        <div class="mt-3 flex flex-wrap gap-3">
          <label
            v-for="mode in BADMINTON_MODES"
            :key="mode.value"
            class="cursor-pointer rounded-lg border-2 px-4 py-3 transition-colors"
            :class="config.mode === mode.value ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 hover:border-stone-300'"
          >
            <input v-model="config.mode" type="radio" name="mode" :value="mode.value" class="sr-only">
            <span class="font-medium">{{ mode.label }}</span>
            <span class="ml-1 text-sm text-stone-500">（{{ mode.teamSize }}人一隊）</span>
          </label>
        </div>
      </fieldset>

      <div class="grid gap-6 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium">場地數量</span>
          <input
            v-model.number="config.courtCount"
            type="number"
            min="1"
            max="10"
            class="mt-1 w-full rounded-lg border border-stone-300 px-4 py-2"
          >
        </label>
        <label class="flex items-center gap-3">
          <input v-model="config.rotationEnabled" type="checkbox" class="h-5 w-5 rounded border-stone-300 text-emerald-600">
          <span class="text-sm font-medium">啟用循環對戰（每隊都會相遇）</span>
        </label>
      </div>

      <fieldset>
        <legend class="text-base font-medium">選手名單</legend>
        <p class="mt-1 text-sm text-stone-500">
          每行輸入一位選手名稱，至少需要 {{ minPlayers }} 位選手
        </p>
        <textarea
          v-model="playersText"
          rows="10"
          class="mt-3 w-full rounded-lg border border-stone-300 px-4 py-3 font-mono text-sm"
          placeholder="王小明
李大華
張三
李四
..."
          aria-label="選手名單，每行一位"
        />
        <p v-if="validationMessage" class="mt-2 text-sm" :class="validationValid ? 'text-amber-600' : 'text-rose-600'">
          {{ validationMessage }}
        </p>
        <p class="mt-2 text-sm text-stone-500">
          已輸入 {{ playerCount }} 位選手，可組成 {{ teamCount }} 隊
        </p>
      </fieldset>

      <button
        type="submit"
        class="rounded-lg bg-emerald-700 px-6 py-2.5 font-medium text-white hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canGenerate"
      >
        產生分組與賽程
      </button>
    </form>

    <div v-if="step === 'result' && drawResult" class="mt-6 space-y-6">
      <section class="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 class="text-lg font-semibold">隊伍分組</h2>
        <p class="mt-1 text-sm text-stone-500">共 {{ drawResult.teams.length }} 隊</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="(team, index) in drawResult.teams"
            :key="team.id"
            class="rounded-xl border border-stone-200 bg-stone-50 p-4"
          >
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                {{ index + 1 }}
              </span>
              <span class="font-medium">{{ team.name }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 class="text-lg font-semibold">賽程表</h2>
        <p class="mt-1 text-sm text-stone-500">共 {{ drawResult.matches.length }} 場比賽</p>
        
        <div class="mt-4 space-y-4">
          <div v-for="round in matchesByRound" :key="round.round">
            <h3 class="mb-2 font-medium text-stone-700">第 {{ round.round }} 輪</h3>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div
                v-for="match in round.matches"
                :key="match.id"
                class="rounded-xl border p-4"
                :class="matchStatusClass(match.status)"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs text-stone-500">場地 {{ match.courtNumber }}</span>
                  <span class="rounded-full px-2 py-0.5 text-xs" :class="statusBadgeClass(match.status)">
                    {{ statusLabel[match.status] }}
                  </span>
                </div>
                <div class="mt-2 flex items-center justify-between">
                  <span class="font-medium">{{ match.teamA.name }}</span>
                  <span class="text-lg font-bold text-stone-400">vs</span>
                  <span class="font-medium">{{ match.teamB.name }}</span>
                </div>
                <div v-if="match.status === 'finished'" class="mt-2 text-center">
                  <span class="text-xl font-bold">{{ match.scoreA }} : {{ match.scoreB }}</span>
                </div>
                <div v-else-if="match.status === 'pending'" class="mt-3 flex gap-2">
                  <button
                    type="button"
                    class="flex-1 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-200"
                    @click="openScoreDialog(match)"
                  >
                    輸入比分
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 class="text-lg font-semibold">積分排名</h2>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-stone-200 text-stone-500">
              <tr>
                <th class="px-3 py-2 font-medium">排名</th>
                <th class="px-3 py-2 font-medium">隊伍</th>
                <th class="px-3 py-2 font-medium text-center">勝</th>
                <th class="px-3 py-2 font-medium text-center">敗</th>
                <th class="px-3 py-2 font-medium text-center">得分</th>
                <th class="px-3 py-2 font-medium text-center">失分</th>
                <th class="px-3 py-2 font-medium text-center">淨分</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(stat, index) in teamStats" :key="stat.team.id" class="border-b border-stone-100">
                <td class="px-3 py-2 font-semibold">{{ index + 1 }}</td>
                <td class="px-3 py-2">{{ stat.team.name }}</td>
                <td class="px-3 py-2 text-center text-emerald-700">{{ stat.wins }}</td>
                <td class="px-3 py-2 text-center text-rose-600">{{ stat.losses }}</td>
                <td class="px-3 py-2 text-center">{{ stat.pointsFor }}</td>
                <td class="px-3 py-2 text-center">{{ stat.pointsAgainst }}</td>
                <td class="px-3 py-2 text-center" :class="stat.pointsFor - stat.pointsAgainst >= 0 ? 'text-emerald-700' : 'text-rose-600'">
                  {{ stat.pointsFor - stat.pointsAgainst >= 0 ? '+' : '' }}{{ stat.pointsFor - stat.pointsAgainst }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div
      v-if="scoreDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="scoreDialog = null"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 class="text-lg font-semibold">輸入比分</h3>
        <p class="mt-1 text-sm text-stone-500">{{ scoreDialog.match.teamA.name }} vs {{ scoreDialog.match.teamB.name }}</p>
        
        <div class="mt-4 flex items-center justify-center gap-4">
          <div class="text-center">
            <label class="text-sm text-stone-500">{{ scoreDialog.match.teamA.name }}</label>
            <input
              v-model.number="scoreDialog.scoreA"
              type="number"
              min="0"
              class="mt-1 w-20 rounded-lg border border-stone-300 px-3 py-2 text-center text-xl font-bold"
              aria-label="A 隊分數"
            >
          </div>
          <span class="text-2xl text-stone-400">:</span>
          <div class="text-center">
            <label class="text-sm text-stone-500">{{ scoreDialog.match.teamB.name }}</label>
            <input
              v-model.number="scoreDialog.scoreB"
              type="number"
              min="0"
              class="mt-1 w-20 rounded-lg border border-stone-300 px-3 py-2 text-center text-xl font-bold"
              aria-label="B 隊分數"
            >
          </div>
        </div>
        
        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
            @click="scoreDialog = null"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            @click="handleSaveScore"
          >
            確認
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  type DrawConfig,
  type DrawResult,
  type GameMode,
  type Match,
  type Player,
  createDrawResult,
  generateId,
  getTeamStats,
  SPORT_DEFAULTS,
  updateMatchScore,
  validatePlayerCount,
} from '~~/shared/draw'

useHead({ title: '羽球抽籤分組' })

type Step = 'setup' | 'result'

const BADMINTON_MODES: Array<{ value: GameMode, label: string, teamSize: number }> = [
  { value: 'singles', label: '單打', teamSize: 1 },
  { value: 'doubles', label: '雙打', teamSize: 2 },
]

const statusLabel: Record<Match['status'], string> = {
  pending: '待進行',
  playing: '進行中',
  finished: '已結束',
}

const step = ref<Step>('setup')
const config = reactive<DrawConfig>({
  sport: 'badminton',
  mode: 'doubles',
  courtCount: 2,
  rotationEnabled: true,
})
const playersText = ref('')
const drawResult = ref<DrawResult | null>(null)
const scoreDialog = ref<{ match: Match, scoreA: number, scoreB: number } | null>(null)

const teamSize = computed(() => SPORT_DEFAULTS.badminton.teamSize[config.mode])
const minPlayers = computed(() => teamSize.value * 2)

const parsedPlayers = computed((): Player[] => {
  return playersText.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(name => ({ id: generateId(), name }))
})

const playerCount = computed(() => parsedPlayers.value.length)
const teamCount = computed(() => Math.floor(playerCount.value / teamSize.value))

const validation = computed(() => validatePlayerCount(playerCount.value, 'badminton', config.mode))
const validationValid = computed(() => validation.value.valid)
const validationMessage = computed(() => validation.value.message)

const canGenerate = computed(() => validation.value.valid && playerCount.value >= minPlayers.value)

const matchesByRound = computed(() => {
  if (!drawResult.value) return []
  
  const rounds = new Map<number, Match[]>()
  for (const match of drawResult.value.matches) {
    const existing = rounds.get(match.round) ?? []
    existing.push(match)
    rounds.set(match.round, existing)
  }
  
  return Array.from(rounds.entries())
    .map(([round, matches]) => ({ round, matches }))
    .sort((a, b) => a.round - b.round)
})

const teamStats = computed(() => {
  if (!drawResult.value) return []
  return getTeamStats(drawResult.value)
})

const matchStatusClass = (status: Match['status']) => {
  if (status === 'finished') return 'border-emerald-200 bg-emerald-50'
  if (status === 'playing') return 'border-amber-200 bg-amber-50'
  return 'border-stone-200 bg-white'
}

const statusBadgeClass = (status: Match['status']) => {
  if (status === 'finished') return 'bg-emerald-100 text-emerald-800'
  if (status === 'playing') return 'bg-amber-100 text-amber-800'
  return 'bg-stone-100 text-stone-600'
}

const handleGenerate = () => {
  const matchType = config.rotationEnabled ? 'roundRobin' : 'knockout'
  drawResult.value = createDrawResult(config, parsedPlayers.value, matchType)
  step.value = 'result'
}

const handleReshuffle = () => {
  const matchType = config.rotationEnabled ? 'roundRobin' : 'knockout'
  drawResult.value = createDrawResult(config, parsedPlayers.value, matchType)
}

const handleReset = () => {
  step.value = 'setup'
  drawResult.value = null
}

const openScoreDialog = (match: Match) => {
  scoreDialog.value = { match, scoreA: 0, scoreB: 0 }
}

const handleSaveScore = () => {
  if (!scoreDialog.value || !drawResult.value) return
  
  drawResult.value = updateMatchScore(
    drawResult.value,
    scoreDialog.value.match.id,
    scoreDialog.value.scoreA,
    scoreDialog.value.scoreB
  )
  scoreDialog.value = null
}
</script>
