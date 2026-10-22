export const impliedProbability = (decimalOdds: number) => 1 / decimalOdds

export const expectedValue = (probability: number, decimalOdds: number) =>
  probability * decimalOdds - 1

export const devigTwoWay = (oddsA: number, oddsB: number) => {
  const impliedA = 1 / oddsA
  const impliedB = 1 / oddsB
  const marketA = impliedA / (impliedA + impliedB)

  return {
    marketA,
    marketB: 1 - marketA,
  }
}

export const devigMultiWay = (odds: number[]) => {
  const implied = odds.map(impliedProbability)
  const overround = implied.reduce((sum, value) => sum + value, 0)
  return implied.map(value => value / overround)
}
