// Comparação de opções de sorteio como partições (docs/architecture.md, "Diversidade
// entre opções de sorteio"). Nomes, cores e ordem dos times não importam.

/** Um time é a lista de ids dos jogadores; uma opção é a lista de times comparados. */
export type Partition = readonly (readonly string[])[];

function permutations(n: number): number[][] {
  if (n <= 1) return [[...Array(n).keys()]];
  const result: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let position = 0; position <= rest.length; position++) {
      result.push([...rest.slice(0, position), n - 1, ...rest.slice(position)]);
    }
  }
  return result;
}

/**
 * Menor número de jogadores que precisam mudar de time para transformar `a` em `b`,
 * no melhor pareamento entre os times: N − max_σ Σ |a_i ∩ b_σ(i)|. Força bruta sobre
 * as permutações (até 4 times = 24).
 */
export function partitionDistance(a: Partition, b: Partition): number {
  if (a.length !== b.length) throw new Error("As opções precisam ter a mesma quantidade de times.");
  const teamOf = new Map<string, number>();
  b.forEach((team, index) => team.forEach((id) => teamOf.set(id, index)));
  const overlap = a.map((team) => {
    const row = new Array<number>(b.length).fill(0);
    for (const id of team) {
      const index = teamOf.get(id);
      if (index === undefined) throw new Error("As opções precisam ter os mesmos jogadores.");
      row[index]++;
    }
    return row;
  });
  const total = a.reduce((sum, team) => sum + team.length, 0);
  let best = 0;
  for (const sigma of permutations(a.length)) {
    const matched = sigma.reduce((sum, j, i) => sum + overlap[i][j], 0);
    if (matched > best) best = matched;
  }
  return total - best;
}

/** Forma canônica para deduplicar candidatos: ids ordenados por time, times ordenados. */
export function canonicalKey(partition: Partition): string {
  return partition
    .map((team) => [...team].sort().join(","))
    .sort()
    .join("|");
}
