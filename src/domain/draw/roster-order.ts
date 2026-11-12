// Ordem de exibição do elenco dentro de cada time do sorteio (UI only).
// Usa o strengthSnapshot da época; não altera geração, votos nem alocação.

export type DrawRosterSortable = {
  memberId: string;
  name: string;
  /** Snapshot da força no sorteio; null só se ausente no registro. */
  strength: number | null;
};

/** Maior força primeiro; empate por nome (pt-BR); desempate estável por memberId. */
export function compareDrawRosterPlayers(a: DrawRosterSortable, b: DrawRosterSortable): number {
  const strengthA = a.strength ?? Number.NEGATIVE_INFINITY;
  const strengthB = b.strength ?? Number.NEGATIVE_INFINITY;
  if (strengthB !== strengthA) return strengthB - strengthA;
  const byName = a.name.localeCompare(b.name, "pt-BR");
  if (byName !== 0) return byName;
  return a.memberId.localeCompare(b.memberId);
}

/** Cópia ordenada — não muta o array original. */
export function sortDrawRosterPlayers<T extends DrawRosterSortable>(players: readonly T[]): T[] {
  return [...players].sort(compareDrawRosterPlayers);
}
