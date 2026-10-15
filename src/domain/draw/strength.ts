// Força do jogador para o sorteio (PROJECT.md, seção 14). Hoje é a nota base; o
// algoritmo de balanceamento recebe só o número, então a fórmula pode evoluir aqui.

export type StrengthInput = { baseRating: number };

export function playerStrength(member: StrengthInput): number {
  return member.baseRating;
}
