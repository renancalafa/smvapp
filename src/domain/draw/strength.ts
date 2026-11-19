// Força do jogador para o sorteio (PROJECT.md, seção 14).
// balance-v2 usa só a nota base. balance-v3 usa atributos multi-eixo via
// `toDrawPlayerV3` (nunca inventa valores faltantes).

import type { DrawPlayerV3, PreferredRoleValue } from "./balance-v3";

export type StrengthInput = { baseRating: number };

export function playerStrength(member: StrengthInput): number {
  return member.baseRating;
}

export type MultiAttrStrengthInput = {
  id: string;
  baseRating: number;
  attackRating: number;
  defenseRating: number;
  physicalRating: number;
  preferredRole: PreferredRoleValue | null;
};

/** Build a v3 player. Call only after rating completeness is verified. */
export function toDrawPlayerV3(member: MultiAttrStrengthInput): DrawPlayerV3 {
  return {
    id: member.id,
    overall: member.baseRating,
    attack: member.attackRating,
    defense: member.defenseRating,
    physical: member.physicalRating,
    preferredRole: member.preferredRole,
    strength: member.baseRating,
  };
}
