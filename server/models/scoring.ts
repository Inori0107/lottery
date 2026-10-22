export type ScoredGame = {
  pointsA: number
  pointsB: number
  sideAWon: boolean
  isLegal: boolean
}

export const isLegalGame = (pointsA: number, pointsB: number) => {
  const high = Math.max(pointsA, pointsB)
  const low = Math.min(pointsA, pointsB)
  if (high === 21 && low <= 19) return true
  if (high >= 22 && high <= 30 && high === low + 2) return true
  if (high === 30 && low === 29) return true
  return false
}

export const assessMatch = (games: ScoredGame[]) => {
  const game1 = games[0]
  const game1Legal = game1?.isLegal === true
  const sideAWonGame1 = game1Legal && game1 ? game1.sideAWon : null
  const allLegal = games.length > 0 && games.every(game => game.isLegal)
  const sideAWins = games.filter(game => game.sideAWon).length
  let matchLegal = false

  if (games.length === 2 && allLegal && games[0]?.sideAWon === games[1]?.sideAWon) {
    matchLegal = true
  }

  if (games.length === 3 && allLegal && games[0]?.sideAWon !== games[1]?.sideAWon) {
    matchLegal = sideAWins === 1 || sideAWins === 2
  }

  return {
    game1Legal,
    sideAWonGame1,
    matchLegal,
    sideAWonMatch: matchLegal ? sideAWins >= 2 : null,
  }
}
