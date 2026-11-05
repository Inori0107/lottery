import { listAdjustmentsForFixture } from '../../models/adjustments'

export default defineEventHandler((event) => {
  const fixtureId = Number(getQuery(event).fixtureId)
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    throw createError({ statusCode: 400, statusMessage: '請提供場次' })
  }
  return listAdjustmentsForFixture(useLedger(), fixtureId)
})
