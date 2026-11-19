/**
 * balance-v3 — multi-axis team balancing (Overall / Attack / Defense / Physical / Role).
 *
 * Activated only when `advancedDrawBalancingEnabled` is ON and every allocated
 * participant has complete ratings. Does not replace balance-v2.
 *
 * Scoring is multi-axis (lexicographic spreads), NOT a weighted sum of attributes.
 * That avoids Overall double-counting and prevents one strong axis from masking
 * a severe weakness on another.
 */
import {
  canonicalKey,
  maxAllowedTeamOverlap,
  maxTeamOverlap,
  partitionDistance,
} from "./partition";
import { shuffle, type Rng } from "./random";

export const DRAW_ALGORITHM_VERSION_V3 = "balance-v3";

export type PreferredRoleValue = "ATTACKER" | "DEFENDER" | "VERSATILE";

export type DrawPlayerV3 = {
  id: string;
  /** Overall Skill (1–5). Also used as legacy `strength` / strengthSnapshot. */
  overall: number;
  attack: number;
  defense: number;
  physical: number;
  preferredRole: PreferredRoleValue | null;
  /** Compatibility alias for overall — used by shared persistence helpers. */
  strength: number;
};

export type AxisSpreads = {
  overall: number;
  attack: number;
  defense: number;
  physical: number;
  topPlayers: number;
  roleAttackers: number;
  roleDefenders: number;
};

export type BalanceMetricsV3 = {
  spreads: AxisSpreads;
  /** Soft role-composition penalty (0 = ideal). */
  rolePenalty: number;
  /** Variance of overall team totals. */
  overallVariance: number;
  /** Primary balanceScore compatibility = overall spread. */
  balanceScore: number;
};

export type BalancedOptionV3 = {
  teams: DrawPlayerV3[][];
  balanceScore: number;
  metrics: BalanceMetricsV3;
};

export type GeneratedDrawV3 = {
  options: BalancedOptionV3[];
  optionDistance: number | null;
  maxTeamOverlap: number | null;
  algorithmVersion: typeof DRAW_ALGORITHM_VERSION_V3;
};

export class DrawGenerationErrorV3 extends Error {}

const TOP_OVERALL = 4;
const CANDIDATE_RESTARTS = 1200;

/**
 * Lexicographic multi-axis cost. Order matters: a large Overall imbalance cannot be
 * offset by perfect Attack; a large Attack imbalance cannot be offset by Physical, etc.
 */
type Cost = [
  overallSpread: number,
  attackSpread: number,
  defenseSpread: number,
  physicalSpread: number,
  topSpread: number,
  rolePenalty: number,
  attackerSpread: number,
  defenderSpread: number,
  overallVariance: number,
];

function sum(team: DrawPlayerV3[], pick: (p: DrawPlayerV3) => number): number {
  return team.reduce((acc, p) => acc + pick(p), 0);
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
}

function roleCounts(team: DrawPlayerV3[]): {
  attackers: number;
  defenders: number;
  versatile: number;
  unset: number;
} {
  let attackers = 0;
  let defenders = 0;
  let versatile = 0;
  let unset = 0;
  for (const p of team) {
    if (p.preferredRole === "ATTACKER") attackers += 1;
    else if (p.preferredRole === "DEFENDER") defenders += 1;
    else if (p.preferredRole === "VERSATILE") versatile += 1;
    else unset += 1;
  }
  return { attackers, defenders, versatile, unset };
}

/**
 * Soft role penalty: discourage attack-heavy / defender-starved teams.
 * Versatile + unset count as flexible fillers (half weight toward covering gaps).
 * Not an absolute constraint — missing preferred roles never invalidate a roster.
 */
function rolePenaltyOf(teams: DrawPlayerV3[][]): number {
  let penalty = 0;
  for (const team of teams) {
    const r = roleCounts(team);
    const flexible = r.versatile + r.unset;
    // Too many dedicated attackers with no dedicated defender.
    if (r.attackers >= 3 && r.defenders === 0) {
      penalty += 2 + Math.max(0, r.attackers - 2);
    }
    // Attack-heavy relative to defensive cover (dedicated + flexible).
    const defensiveCover = r.defenders + flexible;
    if (r.attackers > defensiveCover + 1) {
      penalty += r.attackers - defensiveCover;
    }
    // Defender pile-up with zero attackers (mirror imbalance).
    if (r.defenders >= 3 && r.attackers === 0 && flexible === 0) {
      penalty += 2;
    }
  }
  return penalty;
}

function costOf(teams: DrawPlayerV3[][]): Cost {
  const overalls = teams.map((t) => sum(t, (p) => p.overall));
  const attacks = teams.map((t) => sum(t, (p) => p.attack));
  const defenses = teams.map((t) => sum(t, (p) => p.defense));
  const physicals = teams.map((t) => sum(t, (p) => p.physical));
  const tops = teams.map((t) => t.filter((p) => p.overall >= TOP_OVERALL).length);
  const attackers = teams.map((t) => roleCounts(t).attackers);
  const defenders = teams.map((t) => roleCounts(t).defenders);
  return [
    spread(overalls),
    spread(attacks),
    spread(defenses),
    spread(physicals),
    spread(tops),
    rolePenaltyOf(teams),
    spread(attackers),
    spread(defenders),
    variance(overalls),
  ];
}

function compareCost(a: Cost, b: Cost): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return 0;
}

function metricsFromCost(cost: Cost): BalanceMetricsV3 {
  return {
    spreads: {
      overall: cost[0],
      attack: cost[1],
      defense: cost[2],
      physical: cost[3],
      topPlayers: cost[4],
      roleAttackers: cost[6],
      roleDefenders: cost[7],
    },
    rolePenalty: cost[5],
    overallVariance: cost[8],
    balanceScore: cost[0],
  };
}

function sameFootprint(a: DrawPlayerV3, b: DrawPlayerV3): boolean {
  return (
    a.overall === b.overall &&
    a.attack === b.attack &&
    a.defense === b.defense &&
    a.physical === b.physical &&
    a.preferredRole === b.preferredRole
  );
}

/** Local search via pairwise swaps; accept only strict multi-axis cost improvements. */
function improve(teams: DrawPlayerV3[][]): Cost {
  let cost = costOf(teams);
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        for (let i = 0; i < teams[a]!.length; i++) {
          for (let j = 0; j < teams[b]!.length; j++) {
            if (sameFootprint(teams[a]![i]!, teams[b]![j]!)) continue;
            [teams[a]![i], teams[b]![j]] = [teams[b]![j]!, teams[a]![i]!];
            const next = costOf(teams);
            if (compareCost(next, cost) < 0) {
              cost = next;
              improved = true;
            } else {
              [teams[a]![i], teams[b]![j]] = [teams[b]![j]!, teams[a]![i]!];
            }
          }
        }
      }
    }
  }
  return cost;
}

const ids = (teams: DrawPlayerV3[][]) => teams.map((team) => team.map((p) => p.id));

function optionsCompatible(
  left: DrawPlayerV3[][],
  right: DrawPlayerV3[][],
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
 * Generate `optionsCount` multi-axis-balanced options under the same hard diversity
 * constraints as balance-v2 (minDifference + maxTeamOverlap ≤ 40%).
 */
export function generateDrawOptionsV3(input: {
  players: DrawPlayerV3[];
  teamCount: number;
  teamSize: number;
  optionsCount: number;
  minDifference: number;
  rng: Rng;
}): GeneratedDrawV3 {
  const { players, teamCount, teamSize, optionsCount, minDifference, rng } = input;
  if (players.length !== teamCount * teamSize) {
    throw new DrawGenerationErrorV3(
      `São necessários ${teamCount * teamSize} jogadores para ${teamCount} times de ${teamSize}.`,
    );
  }
  if (optionsCount < 1) {
    throw new DrawGenerationErrorV3("A sessão precisa de pelo menos uma opção de sorteio.");
  }
  for (const p of players) {
    for (const key of ["overall", "attack", "defense", "physical"] as const) {
      const v = p[key];
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        throw new DrawGenerationErrorV3(
          `Jogador ${p.id} tem ${key} inválido para balance-v3 (esperado inteiro 1–5).`,
        );
      }
    }
  }

  const maxOverlap = maxAllowedTeamOverlap(teamSize);
  const candidates = new Map<string, { teams: DrawPlayerV3[][]; cost: Cost }>();
  for (let restart = 0; restart < CANDIDATE_RESTARTS; restart++) {
    const order = shuffle(players, rng);
    const teams = Array.from({ length: teamCount }, (_, index) =>
      order.slice(index * teamSize, (index + 1) * teamSize),
    );
    const cost = improve(teams);
    const key = canonicalKey(ids(teams));
    if (!candidates.has(key)) candidates.set(key, { teams, cost });
  }

  const ranked = shuffle([...candidates.values()], rng).sort((a, b) => compareCost(a.cost, b.cost));
  if (ranked.length === 0) {
    throw new DrawGenerationErrorV3("Não foi possível gerar nenhuma opção de sorteio equilibrada (v3).");
  }

  let chosen: { teams: DrawPlayerV3[][]; cost: Cost }[] | null = null;
  if (optionsCount === 1) {
    chosen = [ranked[0]!];
  } else {
    for (const anchor of ranked) {
      const set = [anchor];
      for (const candidate of ranked) {
        if (set.length === optionsCount) break;
        if (candidate === anchor) continue;
        if (
          set.every((option) =>
            optionsCompatible(option.teams, candidate.teams, minDifference, maxOverlap),
          )
        ) {
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
    throw new DrawGenerationErrorV3(
      `Não foi possível gerar ${optionsCount} opções equilibradas (v3) com diferença mínima de ${minDifference} jogadores${overlapClause}.`,
    );
  }

  let optionDistance: number | null = null;
  let maxOverlapFound: number | null = null;
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const left = ids(chosen[i]!.teams);
      const right = ids(chosen[j]!.teams);
      const distance = partitionDistance(left, right);
      const overlap = maxTeamOverlap(left, right);
      optionDistance = optionDistance === null ? distance : Math.min(optionDistance, distance);
      maxOverlapFound = maxOverlapFound === null ? overlap : Math.max(maxOverlapFound, overlap);
    }
  }

  return {
    algorithmVersion: DRAW_ALGORITHM_VERSION_V3,
    options: chosen.map((option) => {
      const metrics = metricsFromCost(option.cost);
      return {
        teams: option.teams,
        balanceScore: metrics.balanceScore,
        metrics,
      };
    }),
    optionDistance,
    maxTeamOverlap: maxOverlapFound,
  };
}

/** Exported for simulations / tests — evaluate a finished partition without regenerating. */
export function evaluatePartitionV3(teams: DrawPlayerV3[][]): BalanceMetricsV3 {
  return metricsFromCost(costOf(teams));
}
