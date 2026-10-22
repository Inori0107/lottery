import type { H3Event } from 'h3'
import { TSL_ORIGIN } from '../models/tsl'

export const allowSportsbookOrigin = (event: H3Event) => {
  if (getRequestHeader(event, 'origin') !== TSL_ORIGIN) return
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': TSL_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin',
  })
}
