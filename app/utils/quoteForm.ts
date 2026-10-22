import type { CorrectScore, Discipline, PlayerOption } from '~~/shared/types'

export type InputValue = string | number

export type QuoteFormState = {
  discipline: Discipline
  away: PlayerOption | null
  home: PlayerOption | null
  matchAwayOdds: InputValue
  matchHomeOdds: InputValue
  gameAwayOdds: InputValue
  gameHomeOdds: InputValue
  totalLine: InputValue
  totalOverOdds: InputValue
  totalUnderOdds: InputValue
  handicapHomeLine: InputValue
  handicapAwayOdds: InputValue
  handicapHomeOdds: InputValue
  correctScoreOdds: Record<CorrectScore, InputValue>
}

export const emptyQuoteForm = (): QuoteFormState => ({
  discipline: 'MS',
  away: null,
  home: null,
  matchAwayOdds: '',
  matchHomeOdds: '',
  gameAwayOdds: '',
  gameHomeOdds: '',
  totalLine: '',
  totalOverOdds: '',
  totalUnderOdds: '',
  handicapHomeLine: '',
  handicapAwayOdds: '',
  handicapHomeOdds: '',
  correctScoreOdds: { '2:0': '', '2:1': '', '1:2': '', '0:2': '' },
})
