// Geração das opções de sorteio (PROJECT.md, seções 14 e 15; docs/architecture.md,
// "Diversidade entre opções de sorteio"). Função pura e determinística dado o rng.
import { canonicalKey, partitionDistance } from "./partition";
import { shuffle, type Rng } from "./random";

export const DRAW_ALGORITHM_VERSION = "balance-v1";

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
};

export class DrawGenerationError extends Error {}

const TOP_STRENGTH = 4;
const CANDIDATE_RESTARTS = 400;

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

/**
 * Gera `optionsCount` opções equilibradas com `teamCount` times de `teamSize`, todas a
 * pelo menos `minDifference` umas das outras. Sem opção válida, falha explicitamente
 * (a regra de diversidade nunca é relaxada).
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
  const chosen = [ranked[0]];
  for (const candidate of ranked.slice(1)) {
    if (chosen.length === optionsCount) break;
    if (chosen.every((option) => partitionDistance(ids(option.teams), ids(candidate.teams)) >= minDifference)) {
      chosen.push(candidate);
    }
  }
  if (chosen.length < optionsCount) {
    throw new DrawGenerationError(
      `Não foi possível gerar ${optionsCount} opções equilibradas com diferença mínima de ${minDifference} jogadores.`,
    );
  }

  let optionDistance: number | null = null;
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const distance = partitionDistance(ids(chosen[i].teams), ids(chosen[j].teams));
      optionDistance = optionDistance === null ? distance : Math.min(optionDistance, distance);
    }
  }
  return {
    options: chosen.map((option) => ({ teams: option.teams, balanceScore: option.cost[0] })),
    optionDistance,
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
