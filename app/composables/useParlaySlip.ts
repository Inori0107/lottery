import {
  DEFAULT_PARLAY_CONFIG,
  evaluateParlay,
  type ParlayConfig,
  type ParlayLeg,
} from '~~/shared/parlay'

const SLIP_KEY = 'lottery-parlay-slip'
const CONFIG_KEY = 'lottery-parlay-config'

const readJson = <T>(key: string, fallback: T): T => {
  if (!import.meta.client) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export const useParlaySlip = () => {
  const legs = useState<ParlayLeg[]>('parlay-legs', () => [])
  const config = useState<ParlayConfig>('parlay-config', () => ({ ...DEFAULT_PARLAY_CONFIG }))
  const hydrated = useState('parlay-hydrated', () => false)

  const persist = () => {
    if (!import.meta.client) return
    window.localStorage.setItem(SLIP_KEY, JSON.stringify(legs.value))
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config.value))
  }

  const hydrate = () => {
    if (hydrated.value || !import.meta.client) return
    legs.value = readJson<ParlayLeg[]>(SLIP_KEY, [])
    config.value = { ...DEFAULT_PARLAY_CONFIG, ...readJson<Partial<ParlayConfig>>(CONFIG_KEY, {}) }
    hydrated.value = true
  }

  const evaluation = computed(() => evaluateParlay(legs.value, config.value))

  const addLeg = (leg: ParlayLeg) => {
    hydrate()
    const existing = legs.value.findIndex(item => (
      item.fixtureId === leg.fixtureId
      && item.market === leg.market
      && item.outcomeKey === leg.outcomeKey
      && item.line === leg.line
    ))
    if (existing >= 0) {
      const next = [...legs.value]
      next[existing] = { ...leg, id: next[existing]?.id ?? leg.id }
      legs.value = next
    } else {
      legs.value = [...legs.value, leg]
    }
    persist()
  }

  const removeLeg = (id: string) => {
    legs.value = legs.value.filter(leg => leg.id !== id)
    persist()
  }

  const clearLegs = () => {
    legs.value = []
    persist()
  }

  const updateConfig = (patch: Partial<ParlayConfig>) => {
    config.value = { ...config.value, ...patch }
    persist()
  }

  onMounted(hydrate)
  watch([legs, config], persist, { deep: true })

  return { legs, config, evaluation, addLeg, removeLeg, clearLegs, updateConfig, hydrate }
}
