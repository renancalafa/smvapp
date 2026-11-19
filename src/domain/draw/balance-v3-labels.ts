import type { BalanceV3Strategy } from "./balance-v3";

/** Admin-facing copy for advanced balancing strategies (not vote Option A/B). */
export const BALANCE_V3_STRATEGY_UI: Record<
  BalanceV3Strategy,
  { title: string; priority: string; hint: string }
> = {
  A: {
    title: "Equilíbrio físico (A)",
    priority: "Geral → Ataque → Defesa → Físico → Craques → Posições",
    hint: "Prioriza times com força física parecida depois do equilíbrio Geral/Ataque/Defesa.",
  },
  C: {
    title: "Distribuição de craques (C)",
    priority: "Geral → Ataque → Defesa → Craques → Físico → Posições",
    hint: "Após Geral/Ataque/Defesa, espalha jogadores nota 4–5 antes de equilibrar o físico.",
  },
};

export function balancingStrategyLabel(strategy: string | null | undefined): string | null {
  if (strategy === "A" || strategy === "C") return BALANCE_V3_STRATEGY_UI[strategy].title;
  return null;
}
