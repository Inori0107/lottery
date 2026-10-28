import type { SlipLeg } from '~~/shared/types'
import { MAX_PARLAY_LEGS } from '~~/shared/parlay'

export const useParlaySlip = () => {
  const legs = useState<SlipLeg[]>('parlay-slip-legs', () => [])
  const message = useState('parlay-slip-message', () => '')

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

  return { legs, message, addLeg, removeLeg, clearLegs }
}
