import type { Set1Method } from '../../shared/types'
import { clampGame1ToMatch, matchProbabilityToGame1, predictBin, predictLogistic, type LogisticCoefficients, type ProbabilityBin } from './game1'

// Both backtesting and live quoting consume canonical Side A features.
export const predictFirstGame = (
  features: { pMatch: number; eloDiff: number; formDiff: number },
  model: { method: Set1Method; coefficients: LogisticCoefficients; bins: ProbabilityBin[] },
) => {
  const raw = model.method === 'logistic'
    ? predictLogistic(model.coefficients, features.eloDiff, features.formDiff)
    : model.method === 'bins'
      ? predictBin(model.bins, features.eloDiff)
      : matchProbabilityToGame1(features.pMatch)
  return clampGame1ToMatch(raw, features.pMatch)
}
