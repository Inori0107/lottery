<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <NuxtLink to="/draw" class="text-sm text-stone-500 hover:text-stone-700">← 返回選擇運動</NuxtLink>
        <h1 class="mt-1 text-2xl font-semibold">排球抽籤分組</h1>
      </div>
      <div v-if="step === 'result'" class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          @click="handleReshuffle"
        >
          重新抽籤
        </button>
        <button
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          @click="handleReset"
        >
          重新開始
        </button>
      </div>
    </div>

    <div class="mt-4 rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
      <p class="font-medium">排球規則說明</p>
      <ul class="mt-1 list-inside list-disc text-orange-700">
        <li>每隊 6 人制</li>
        <li>採用循環對戰制，每隊都會與其他隊伍比賽</li>
        <li>可依據實際狀況調整場地數量</li>
      </ul>
    </div>

    <form v-if="step === 'setup'" class="mt-6 space-y-6 rounded-2xl border border-stone-200 bg-white p-6" @submit.prevent="handleGenerate">
      <fieldset>
        <legend class="text-base font-medium">隊伍設定</legend>
        <p class="mt-1 text-sm text-stone-500">排球採用 6 人制隊伍</p>
        <div class="mt-3 flex items-center gap-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <span class="text-4xl">🏐</span>
          <div>
            <span class="font-semibold text-orange-800">6 人制團隊賽</span>
            <p class="text-sm text-orange-600">每隊 6 位選手，標準排球陣容</p>
          </div>
        </div>
      </fieldset>

      <div class="grid gap-6 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium">場地數量</span>
          <input
            v-model.number="config.courtCount"
            type="number"
            min="1"
            max="4"
            class="mt-1 w-full rounded-lg border border-stone-300 px-4 py-2"
          >
          <p class="mt-1 text-xs text-stone-500">同時進行的比賽場數</p>
        </label>
        <label class="flex items-center gap-3">
          <input v-model="config.rotationEnabled" type="checkbox" class="h-5 w-5 rounded border-stone-300 text-orange-600">
          <div>
            <span class="text-sm font-medium">啟用循環對戰</span>
            <p class="text-xs text-stone-500">每隊都會與其他隊伍比賽一次</p>
          </div>
        </label>
      </div>

      <fieldset>
        <legend class="text-base font-medium">選手名單</legend>
        <p class="mt-1 text-sm text-stone-500">
          每行輸入一位選手名稱，至少需要 {{ minPlayers }} 位選手（2 隊）
        </p>
        <textarea
          v-model="playersText"
          rows="12"
          class="mt-3 w-full rounded-lg border border-stone-300 px-4 py-3 font-mono text-sm"
          placeholder="王小明
李大華
張三
李四
王五
趙六
孫七
周八
吳九
鄭十
錢十一
何十二
..."
          aria-label="選手名單，每行一位"
        />
        <p v-if="validationMessage" class="mt-2 text-sm" :class="validationValid ? 'text-amber-600' : 'text-rose-600'">
          {{ validationMessage }}
        </p>
        <p class="mt-2 text-sm text-stone-500">
          已輸入 {{ playerCount }} 位選手，可組成 {{ teamCount }} 隊（每隊 6 人）
          <span v-if="remainder > 0" class="text-amber-600">，{{ remainder }} 位候補</span>
        </p>
      </fieldset>

      <div v-if="teamCount >= 2" class="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
        <p class="text-sm font-medium">預估賽程</p>
        <p class="mt-1 text-sm text-stone-600">
          {{ teamCount }} 隊循環對戰，共 {{ totalMatches }} 場比賽
          <span v-if="config.courtCount > 1">，{{ config.courtCount }} 場同時進行</span>
        </p>
      </div>

      <button
        type="submit"
        class="rounded-lg bg-orange-600 px-6 py-2.5 font-medium text-white hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canGenerate"
      >
        產生分組與賽程
      </button>
    </form>

    <div v-if="step === 'result' && drawResult" class="mt-6 space-y-6">
      <section class="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 class="text-lg font-semibold">隊伍分組</h2>
        <p class="mt-1 text-sm text-stone-500">共 {{ drawResult.teams.length }} 隊，每隊 6 人</p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="(team, index) in drawResult.teams"
            :key="team.id"
            class="rounded-xl border border-stone-200 bg-gradient-to-br from-orange-50 to-white p-4"
          >
            <div class="flex items-center gap-3">
              <span class="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-lg font-bold text-orange-800">
                {{ index + 1 }}
              </span>
              <div>
                <span class="font-semibold">第 {{ index + 1 }} 隊</span>
                <p class="text-xs text-stone-500">{{ team.players.length }} 位選手</p>
              </div>
            </div>
            <ul class="mt-3 space-y-1">
              <li
                v-for="(player, pIndex) in team.players"
                :key="player.id"
                class="flex items-center gap-2 text-sm"
              >
                <span class="h-6 w-6 rounded-full bg-stone-100 text-center text-xs leading-6 text-stone-500">
                  {{ pIndex + 1 }}
                </span>
                <span>{{ player.name }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section v-if="substitutes.length > 0" class="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 class="text-lg font-semibold text-amber-900">候補選手</h2>
        <p class="mt-1 text-sm text-amber-700">以下選手未能組成完整隊伍</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="player in substitutes"
            :key="player.id"
            class="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800"
          >
            {{ player.name }}
          </span>
        </div>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 class="text-lg font-semibold">賽程表</h2>
        <p class="mt-1 text-sm text-stone-500">共 {{ drawResult.matches.length }} 場比賽</p>
        
        <div class="mt-4 space-y-6">
          <div v-for="round in matchesByRound" :key="round.round">
            <h3 class="mb-3 flex items-center gap-2">
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-800">
                {{ round.round }}
              </span>
              <span class="font-medium text-stone-700">第 {{ round.round }} 輪</span>
            </h3>
            <div class="grid gap-4 sm:grid-cols-2">
              <div
                v-for="match in round.matches"
                :key="match.id"
                class="rounded-xl border-2 p-4"
                :class="matchStatusClass(match.status)"
              >
                <div class="flex items-center justify-between">
                  <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                    場地 {{ match.courtNumber }}
                  </span>
                  <span class="rounded-full px-2 py-0.5 text-xs" :class="statusBadgeClass(match.status)">
                    {{ statusLabel[match.status] }}
                  </span>
                </div>
                <div class="mt-3 flex items-center justify-between gap-4">
                  <div class="flex-1 text-center">
                    <p class="text-sm text-stone-500">A 隊</p>
                    <p class="mt-1 font-semibold">第 {{ getTeamNumber(match.teamA.id) }} 隊</p>
                    <p class="mt-1 text-xs text-stone-500 line-clamp-2">{{ match.teamA.name }}</p>
                  </div>
                  <div class="flex flex-col items-center">
                    <span class="text-2xl font-bold text-stone-300">VS</span>
                    <span v-if="match.status === 'finished'" class="mt-1 text-xl font-bold text-orange-600">
                      {{ match.scoreA }} : {{ match.scoreB }}
                    </span>
                  </div>
                  <div class="flex-1 text-center">
                    <p class="text-sm text-stone-500">B 隊</p>
                    <p class="mt-1 font-semibold">第 {{ getTeamNumber(match.teamB.id) }} 隊</p>
                    <p class="mt-1 text-xs text-stone-500 line-clamp-2">{{ match.teamB.name }}</p>
                  </div>
                </div>
                <div v-if="match.status === 'pending'" class="mt-4">
                  <button
                    type="button"
                    class="w-full rounded-lg bg-orange-100 px-4 py-2 text-sm font-medium text-orange-800 hover:bg-orange-200"
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
        <p class="mt-1 text-sm text-stone-500">依勝場數與淨分排序</p>
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
              <tr
                v-for="(stat, index) in teamStats"
                :key="stat.team.id"
                class="border-b border-stone-100"
                :class="index < 3 ? 'bg-orange-50/50' : ''"
              >
                <td class="px-3 py-2">
                  <span
                    class="inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold"
                    :class="rankClass(index)"
                  >
                    {{ index + 1 }}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <span class="font-medium">第 {{ getTeamNumber(stat.team.id) }} 隊</span>
                  <p class="text-xs text-stone-500 line-clamp-1">{{ stat.team.name }}</p>
                </td>
                <td class="px-3 py-2 text-center font-semibold text-emerald-700">{{ stat.wins }}</td>
                <td class="px-3 py-2 text-center text-rose-600">{{ stat.losses }}</td>
                <td class="px-3 py-2 text-center">{{ stat.pointsFor }}</td>
                <td class="px-3 py-2 text-center">{{ stat.pointsAgainst }}</td>
                <td class="px-3 py-2 text-center font-semibold" :class="stat.pointsFor - stat.pointsAgainst >= 0 ? 'text-emerald-700' : 'text-rose-600'">
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="score-dialog-title"
      @click.self="scoreDialog = null"
      @keydown.escape="scoreDialog = null"
    >
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="score-dialog-title" class="text-lg font-semibold">輸入比分</h3>
        <p class="mt-1 text-sm text-stone-500">
          第 {{ getTeamNumber(scoreDialog.match.teamA.id) }} 隊 vs 第 {{ getTeamNumber(scoreDialog.match.teamB.id) }} 隊
        </p>
        
        <div class="mt-6 flex items-center justify-center gap-6">
          <div class="text-center">
            <label class="text-sm font-medium text-stone-700">第 {{ getTeamNumber(scoreDialog.match.teamA.id) }} 隊</label>
            <input
              v-model.number="scoreDialog.scoreA"
              type="number"
              min="0"
              class="mt-2 w-24 rounded-lg border-2 border-orange-200 px-3 py-3 text-center text-2xl font-bold focus:border-orange-500 focus:outline-none"
              aria-label="A 隊分數"
            >
          </div>
          <span class="text-3xl font-bold text-stone-300">:</span>
          <div class="text-center">
            <label class="text-sm font-medium text-stone-700">第 {{ getTeamNumber(scoreDialog.match.teamB.id) }} 隊</label>
            <input
              v-model.number="scoreDialog.scoreB"
              type="number"
              min="0"
              class="mt-2 w-24 rounded-lg border-2 border-orange-200 px-3 py-3 text-center text-2xl font-bold focus:border-orange-500 focus:outline-none"
              aria-label="B 隊分數"
            >
          </div>
        </div>
        
        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
            @click="scoreDialog = null"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
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
  type Match,
  type Player,
  createDrawResult,
  generateId,
  getTeamStats,
  SPORT_DEFAULTS,
  updateMatchScore,
  validatePlayerCount,
} from '~~/shared/draw'

useHead({ title: '排球抽籤分組' })

type Step = 'setup' | 'result'

const TEAM_SIZE = 6

const statusLabel: Record<Match['status'], string> = {
  pending: '待進行',
  playing: '進行中',
  finished: '已結束',
}

const step = ref<Step>('setup')
const config = reactive<DrawConfig>({
  sport: 'volleyball',
  mode: 'team',
  courtCount: 1,
  rotationEnabled: true,
})
const playersText = ref('')
const drawResult = ref<DrawResult | null>(null)
const scoreDialog = ref<{ match: Match, scoreA: number, scoreB: number } | null>(null)

const minPlayers = TEAM_SIZE * 2

const parsedPlayers = computed((): Player[] => {
  return playersText.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(name => ({ id: generateId(), name }))
})

const playerCount = computed(() => parsedPlayers.value.length)
const teamCount = computed(() => Math.floor(playerCount.value / TEAM_SIZE))
const remainder = computed(() => playerCount.value % TEAM_SIZE)
const totalMatches = computed(() => (teamCount.value * (teamCount.value - 1)) / 2)

const validation = computed(() => validatePlayerCount(playerCount.value, 'volleyball', 'team'))
const validationValid = computed(() => validation.value.valid)
const validationMessage = computed(() => validation.value.message)

const canGenerate = computed(() => validation.value.valid && playerCount.value >= minPlayers)

const substitutes = computed((): Player[] => {
  if (!drawResult.value) return []
  const teamPlayerIds = new Set(
    drawResult.value.teams.flatMap(t => t.players.map(p => p.id))
  )
  return parsedPlayers.value.filter(p => !teamPlayerIds.has(p.id))
})

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

const getTeamNumber = (teamId: string): number => {
  if (!drawResult.value) return 0
  const index = drawResult.value.teams.findIndex(t => t.id === teamId)
  return index + 1
}

const matchStatusClass = (status: Match['status']) => {
  if (status === 'finished') return 'border-emerald-300 bg-emerald-50'
  if (status === 'playing') return 'border-amber-300 bg-amber-50'
  return 'border-stone-200 bg-white'
}

const statusBadgeClass = (status: Match['status']) => {
  if (status === 'finished') return 'bg-emerald-100 text-emerald-800'
  if (status === 'playing') return 'bg-amber-100 text-amber-800'
  return 'bg-stone-100 text-stone-600'
}

const rankClass = (index: number) => {
  if (index === 0) return 'bg-amber-400 text-white'
  if (index === 1) return 'bg-stone-300 text-white'
  if (index === 2) return 'bg-amber-600 text-white'
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
