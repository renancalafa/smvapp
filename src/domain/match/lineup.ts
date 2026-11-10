/** Jogadores ainda em campo (substituições usam leftAt). */
export function activeMatchPlayers<T extends { leftAt: string | null }>(players: readonly T[]): T[] {
  return players.filter((player) => player.leftAt === null);
}
