import type { SlipLeg } from '~~/shared/types'
import {
  DEFAULT_PARLAY_CONFIG,
  evaluateParlay,
  MAX_PARLAY_LEGS,
  type ParlayConfig,
} from '~~/shared/parlay'

const CONFIG_KEY = 'lottery-parlay-config'

const readConfig = (): ParlayConfig => {
  if (!import.meta.client) return { ...DEFAULT_PARLAY_CONFIG }
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY)
    return raw ? { ...DEFAULT_PARLAY_CONFIG, ...JSON.parse(raw) as Partial<ParlayConfig> } : { ...DEFAULT_PARLAY_CONFIG }
  } catch {
    return { ...DEFAULT_PARLAY_CONFIG }
  }
}

export const useParlaySlip = () => {
  const legs = useState<SlipLeg[]>('parlay-slip-legs', () => [])
  const message = useState('parlay-slip-message', () => '')
  const config = useState<ParlayConfig>('parlay-config', () => ({ ...DEFAULT_PARLAY_CONFIG }))
  const hydrated = useState('parlay-config-hydrated', () => false)

  const persistConfig = () => {
    if (!import.meta.client) return
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config.value))
  }

  const hydrate = () => {
    if (hydrated.value || !import.meta.client) return
    config.value = readConfig()
    hydrated.value = true
  }

  const evaluation = computed(() => evaluateParlay(legs.value, config.value))

  const addLeg = (leg: SlipLeg) => {
    if (leg.fixtureId === null) {
      message.value = '沒有對上運彩場次，無法加入投注單'
      return false
    }
    if (legs.value.some(existing => existing.fixtureId === leg.fixtureId)) {
      message.value = '同場不可串關'
      return false
    }
    if (legs.value.length >= MAX_PARLAY_LEGS) {
      message.value = `過關最多 ${MAX_PARLAY_LEGS} 腿`
      return false
    }
    legs.value = [...legs.value, leg]
    message.value = `已加入投注單（${legs.value.length} 腿）`
    return true
  }

  const removeLeg = (index: number) => {
    legs.value = legs.value.filter((_, current) => current !== index)
  }

  const clearLegs = () => {
    legs.value = []
  }

  const updateConfig = (patch: Partial<ParlayConfig>) => {
    config.value = { ...config.value, ...patch }
    persistConfig()
  }

  onMounted(hydrate)
  watch(config, persistConfig, { deep: true })

  return { legs, message, addLeg, removeLeg, clearLegs, config, evaluation, updateConfig, hydrate }
}
