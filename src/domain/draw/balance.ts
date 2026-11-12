// Geração das opções de sorteio (PROJECT.md, seções 14 e 15; docs/architecture.md,
// "Diversidade entre opções de sorteio"). Função pura e determinística dado o rng.
import {
  canonicalKey,
  maxAllowedTeamOverlap,
  maxTeamOverlap,
  partitionDistance,
} from "./partition";
import { shuffle, type Rng } from "./random";

export const DRAW_ALGORITHM_VERSION = "balance-v2";

export type DrawPlayer = { id: string; strength: number };

export type BalancedOption = {
  teams: DrawPlayer[][];
  /** Diferença entre o time mais forte e o mais fraco (menor é melhor). Somente ADMIN. */
  balanceScore: number;
};

export type GeneratedDraw = {
  options: BalancedOption[];
  /** Menor distância entre pares de opções; nula com uma única opção. */
  optionDistance: number | null;
  /**
   * Maior |A_i ∩ B_j| entre qualquer par de times de opções distintas; nula com uma
   * única opção. Com times de 5, deve ser ≤ 2.
   */
  maxTeamOverlap: number | null;
};

export class DrawGenerationError extends Error {}

const TOP_STRENGTH = 4;
/** Reinícios ampliados para achar pares com distância mínima e sobreposição ≤ 40%. */
const CANDIDATE_RESTARTS = 1200;

/** Custo lexicográfico: diferença de força total, distribuição dos craques, variância. */
type Cost = [number, number, number];

function teamTotal(team: DrawPlayer[]): number {
  return team.reduce((sum, player) => sum + player.strength, 0);
}

function costOf(teams: DrawPlayer[][]): Cost {
  const totals = teams.map(teamTotal);
  const tops = teams.map((team) => team.filter((player) => player.strength >= TOP_STRENGTH).length);
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  return [
    Math.max(...totals) - Math.min(...totals),
    Math.max(...tops) - Math.min(...tops),
    totals.reduce((sum, value) => sum + (value - mean) ** 2, 0),
  ];
}

function compareCost(a: Cost, b: Cost): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Busca local por trocas entre times até não haver melhora. */
function improve(teams: DrawPlayer[][]): Cost {
  let cost = costOf(teams);
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        for (let i = 0; i < teams[a].length; i++) {
          for (let j = 0; j < teams[b].length; j++) {
            if (teams[a][i].strength === teams[b][j].strength) continue;
            [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
            const next = costOf(teams);
            if (compareCost(next, cost) < 0) {
              cost = next;
              improved = true;
            } else {
              [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
            }
          }
        }
      }
    }
  }
  return cost;
}

const ids = (teams: DrawPlayer[][]) => teams.map((team) => team.map((player) => player.id));

function optionsCompatible(
  left: DrawPlayer[][],
  right: DrawPlayer[][],
  minDifference: number,
  maxOverlap: number | null,
): boolean {
  const a = ids(left);
  const b = ids(right);
  if (partitionDistance(a, b) < minDifference) return false;
  if (maxOverlap !== null && maxTeamOverlap(a, b) > maxOverlap) return false;
  return true;
}

/**
 * Gera `optionsCount` opções equilibradas com `teamCount` times de `teamSize`, todas a
 * pelo menos `minDifference` umas das outras e com sobreposição de time cruzada ≤ 40%
 * (`maxAllowedTeamOverlap`). Sem opção válida, falha explicitamente (nunca relaxa).
 */
export function generateDrawOptions(input: {
  players: DrawPlayer[];
  teamCount: number;
  teamSize: number;
  optionsCount: number;
  minDifference: number;
  rng: Rng;
}): GeneratedDraw {
  const { players, teamCount, teamSize, optionsCount, minDifference, rng } = input;
  if (players.length !== teamCount * teamSize) {
    throw new DrawGenerationError(`São necessários ${teamCount * teamSize} jogadores para ${teamCount} times de ${teamSize}.`);
  }
  if (optionsCount < 1) throw new DrawGenerationError("A sessão precisa de pelo menos uma opção de sorteio.");

  const maxOverlap = maxAllowedTeamOverlap(teamSize);
  const candidates = new Map<string, { teams: DrawPlayer[][]; cost: Cost }>();
  for (let restart = 0; restart < CANDIDATE_RESTARTS; restart++) {
    const order = shuffle(players, rng);
    const teams = Array.from({ length: teamCount }, (_, index) => order.slice(index * teamSize, (index + 1) * teamSize));
    const cost = improve(teams);
    const key = canonicalKey(ids(teams));
    if (!candidates.has(key)) candidates.set(key, { teams, cost });
  }

  // Embaralhar antes da ordenação estável sorteia entre candidatos de mesmo custo.
  const ranked = shuffle([...candidates.values()], rng).sort((a, b) => compareCost(a.cost, b.cost));
  if (ranked.length === 0) {
    throw new DrawGenerationError("Não foi possível gerar nenhuma opção de sorteio equilibrada.");
  }

  let chosen: { teams: DrawPlayer[][]; cost: Cost }[] | null = null;
  if (optionsCount === 1) {
    chosen = [ranked[0]];
  } else {
    // Tenta cada âncora (melhor força primeiro) até montar um conjunto completo compatível.
    for (const anchor of ranked) {
      const set = [anchor];
      for (const candidate of ranked) {
        if (set.length === optionsCount) break;
        if (candidate === anchor) continue;
        if (set.every((option) => optionsCompatible(option.teams, candidate.teams, minDifference, maxOverlap))) {
          set.push(candidate);
        }
      }
      if (set.length === optionsCount) {
        chosen = set;
        break;
      }
    }
  }

  if (!chosen || chosen.length < optionsCount) {
    const overlapClause =
      maxOverlap === null ? "" : ` e sobreposição máxima de ${maxOverlap} por time`;
    throw new DrawGenerationError(
      `Não foi possível gerar ${optionsCount} opções equilibradas com diferença mínima de ${minDifference} jogadores${overlapClause}.`,
    );
  }

  let optionDistance: number | null = null;
  let maxOverlapFound: number | null = null;
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const left = ids(chosen[i].teams);
      const right = ids(chosen[j].teams);
      const distance = partitionDistance(left, right);
      const overlap = maxTeamOverlap(left, right);
      optionDistance = optionDistance === null ? distance : Math.min(optionDistance, distance);
      maxOverlapFound = maxOverlapFound === null ? overlap : Math.max(maxOverlapFound, overlap);
    }
  }
  return {
    options: chosen.map((option) => ({ teams: option.teams, balanceScore: option.cost[0] })),
    optionDistance,
    maxTeamOverlap: maxOverlapFound,
  };
}

/** Times a sortear conforme a quantidade de participantes (PROJECT.md, seção 12). */
export type DrawPlan =
  | { ok: true; teamCount: number; rotatorsRequired: number }
  | { ok: false; error: string };

export function planDraw(input: {
  participants: number;
  teamSize: number;
  overflowMode: "FIXED_TEAMS" | "FLEXIBLE_ROTATION" | null;
}): DrawPlan {
  const { participants, teamSize, overflowMode } = input;
  const three = teamSize * 3;
  const four = teamSize * 4;
  if (participants === four) return { ok: true, teamCount: 4, rotatorsRequired: 0 };
  if (participants === three) return { ok: true, teamCount: 3, rotatorsRequired: 0 };
  if (participants < three) {
    return { ok: false, error: `Com menos de ${three} participantes não há sorteio automático.` };
  }
  if (participants > four) return { ok: false, error: `O sorteio aceita no máximo ${four} participantes.` };
  if (!overflowMode) {
    return { ok: false, error: `Com ${participants} participantes, escolha antes entre times fixos e rotativos.` };
  }
  if (overflowMode === "FIXED_TEAMS") {
    return { ok: false, error: `Em times fixos a sessão precisa ter exatamente ${three} participantes.` };
  }
  return { ok: true, teamCount: 3, rotatorsRequired: participants - three };
}

/**
 * Sorteio antecipado (antes do prazo dos mensalistas): só com a sessão cheia, porque uma vaga
 * livre ainda é dos mensalistas que não confirmaram. A formação (times completos ou rotativos)
 * segue `planDraw`, como depois do prazo.
 */
export function earlyDrawAllowed(input: { participants: number; capacity: number }): boolean {
  return input.participants === input.capacity;
}

export const EARLY_DRAW_REQUIREMENT =
  "Antes do prazo dos mensalistas, o sorteio só pode ser feito com a sessão cheia.";

export const EARLY_FIXED_TEAMS_MESSAGE =
  "Times fixos só depois do prazo dos mensalistas: reduzir a capacidade agora tiraria vagas de mensalistas.";

export const EARLY_FORMATION_REQUIREMENT =
  "Antes do prazo dos mensalistas, a formação com rotativos só pode ser escolhida com a sessão cheia.";
