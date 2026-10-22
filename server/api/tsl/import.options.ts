import { allowSportsbookOrigin } from '../../utils/sportsbookCors'

export default defineEventHandler((event) => {
  allowSportsbookOrigin(event)
  setResponseStatus(event, 204)
  return null
})
