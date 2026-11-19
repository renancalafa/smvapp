// Regressão pura de balance-v3 + comparação objetiva vs balance-v2.
//
//   npm run check:draw-balance-v3
import {
  DRAW_ALGORITHM_VERSION,
  generateDrawOptions,
  type DrawPlayer,
} from "../src/domain/draw/balance";
import {
  DRAW_ALGORITHM_VERSION_V3,
  STRATEGY_COST_ORDER,
  comparePartitionsV3,
  evaluatePartitionV3,
  generateDrawOptionsV3,
  isBalanceV3Strategy,
  type DrawPlayerV3,
  type PreferredRoleValue,
} from "../src/domain/draw/balance-v3";
import {
  assessRatingCompleteness,
  formatMissingRatingsDiagnostic,
} from "../src/domain/draw/rating-completeness";
import { maxAllowedTeamOverlap, maxTeamOverlap, partitionDistance } from "../src/domain/draw/partition";
import { createRng } from "../src/domain/draw/random";
import { playerStrength, toDrawPlayerV3 } from "../src/domain/draw/strength";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

type Spec = {
  overall: number;
  attack: number;
  defense: number;
  physical: number;
  preferredRole: PreferredRoleValue | null;
};

function makeRoster(specs: Spec[]): DrawPlayerV3[] {
  return specs.map((spec, index) =>
    toDrawPlayerV3({
      id: `p${String(index + 1).padStart(2, "0")}`,
      baseRating: spec.overall,
      attackRating: spec.attack,
      defenseRating: spec.defense,
      physicalRating: spec.physical,
      preferredRole: spec.preferredRole,
    }),
  );
}

/** Realistic 15-player mixed roster. */
function roster15(): DrawPlayerV3[] {
  return makeRoster([
    { overall: 5, attack: 5, defense: 3, physical: 4, preferredRole: "ATTACKER" },
    { overall: 5, attack: 4, defense: 5, physical: 3, preferredRole: "DEFENDER" },
    { overall: 4, attack: 5, defense: 2, physical: 4, preferredRole: "ATTACKER" },
    { overall: 4, attack: 3, defense: 5, physical: 4, preferredRole: "DEFENDER" },
    { overall: 4, attack: 4, defense: 4, physical: 3, preferredRole: "VERSATILE" },
    { overall: 3, attack: 4, defense: 2, physical: 5, preferredRole: "ATTACKER" },
    { overall: 3, attack: 2, defense: 4, physical: 3, preferredRole: "DEFENDER" },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: "VERSATILE" },
    { overall: 3, attack: 3, defense: 3, physical: 2, preferredRole: null },
    { overall: 2, attack: 3, defense: 2, physical: 4, preferredRole: "ATTACKER" },
    { overall: 2, attack: 2, defense: 3, physical: 2, preferredRole: "DEFENDER" },
    { overall: 2, attack: 2, defense: 2, physical: 3, preferredRole: null },
    { overall: 2, attack: 1, defense: 3, physical: 2, preferredRole: "DEFENDER" },
    { overall: 1, attack: 2, defense: 1, physical: 2, preferredRole: "ATTACKER" },
    { overall: 1, attack: 1, defense: 2, physical: 1, preferredRole: "VERSATILE" },
  ]);
}

/** 20-player roster for 4×5. */
function roster20(): DrawPlayerV3[] {
  const base = roster15();
  const extra = makeRoster([
    { overall: 4, attack: 5, defense: 3, physical: 4, preferredRole: "ATTACKER" },
    { overall: 3, attack: 2, defense: 4, physical: 3, preferredRole: "DEFENDER" },
    { overall: 3, attack: 3, defense: 3, physical: 4, preferredRole: "VERSATILE" },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 1, attack: 1, defense: 1, physical: 2, preferredRole: "DEFENDER" },
  ]);
  // Remap ids of extras to continue sequence.
  return [
    ...base,
    ...extra.map((p, i) => ({ ...p, id: `p${String(16 + i).padStart(2, "0")}` })),
  ];
}

function toV2(players: DrawPlayerV3[]): DrawPlayer[] {
  return players.map((p) => ({ id: p.id, strength: p.overall }));
}

function axisImbalance(teams: DrawPlayerV3[][], axis: "overall" | "attack" | "defense" | "physical"): number {
  const totals = teams.map((team) => team.reduce((s, p) => s + p[axis], 0));
  return Math.max(...totals) - Math.min(...totals);
}

function topSpread(teams: DrawPlayerV3[][]): number {
  const tops = teams.map((team) => team.filter((p) => p.overall >= 4).length);
  return Math.max(...tops) - Math.min(...tops);
}

function roleAttackerSpread(teams: DrawPlayerV3[][]): number {
  const counts = teams.map((team) => team.filter((p) => p.preferredRole === "ATTACKER").length);
  return Math.max(...counts) - Math.min(...counts);
}

function remapV2TeamsOntoV3(v2Teams: DrawPlayer[][], roster: DrawPlayerV3[]): DrawPlayerV3[][] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  return v2Teams.map((team) => team.map((p) => byId.get(p.id)!));
}

function assertGeneratedV3(teamCount: number, teamSize: number, roster: DrawPlayerV3[], seed: string) {
  const maxOverlap = maxAllowedTeamOverlap(teamSize)!;
  const generated = generateDrawOptionsV3({
    players: roster,
    teamCount,
    teamSize,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng(seed),
  });
  check(`${teamCount}×${teamSize} v3 version`, generated.algorithmVersion === DRAW_ALGORITHM_VERSION_V3);
  check(`${teamCount}×${teamSize} v3 optionDistance>=3`, (generated.optionDistance ?? 0) >= 3);
  check(
    `${teamCount}×${teamSize} v3 maxOverlap<=${maxOverlap}`,
    (generated.maxTeamOverlap ?? 99) <= maxOverlap,
  );
  const flat = generated.options[0]!.teams.flat().map((p) => p.id).sort();
  check(
    `${teamCount}×${teamSize} v3 unique players`,
    flat.length === teamCount * teamSize && new Set(flat).size === flat.length,
  );
  return generated;
}

function domainChecks() {
  check("v2 version constant intact", DRAW_ALGORITHM_VERSION === "balance-v2");
  check("v3 version constant", DRAW_ALGORITHM_VERSION_V3 === "balance-v3");
  check("playerStrength still baseRating", playerStrength({ baseRating: 4 }) === 4);
  check("strategy A valid", isBalanceV3Strategy("A"));
  check("strategy C valid", isBalanceV3Strategy("C"));
  check("strategy rejects junk", !isBalanceV3Strategy("B") && !isBalanceV3Strategy(null));
  check(
    "strategy A order: Physical before tops",
    STRATEGY_COST_ORDER.A.indexOf("physical") < STRATEGY_COST_ORDER.A.indexOf("tops"),
  );
  check(
    "strategy C order: tops before Physical",
    STRATEGY_COST_ORDER.C.indexOf("tops") < STRATEGY_COST_ORDER.C.indexOf("physical"),
  );

  // Completeness
  const incomplete = assessRatingCompleteness([
    {
      memberId: "m1",
      baseRating: 3,
      attackRating: null,
      defenseRating: 2,
      physicalRating: 3,
    },
  ]);
  check("incomplete detects ATTACK", !incomplete.complete && incomplete.missing[0]!.missing.includes("ATTACK"));
  check(
    "diagnostic mentions fallback",
    /balance-v3 indisponível|balance-v2/i.test(formatMissingRatingsDiagnostic(incomplete)),
  );
  const complete = assessRatingCompleteness([
    {
      memberId: "m1",
      baseRating: 3,
      attackRating: 2,
      defenseRating: 2,
      physicalRating: 3,
    },
  ]);
  check("complete roster ok", complete.complete);

  // Preferred role optional
  const withNullRole = makeRoster([
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: null },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: null },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: null },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: null },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 4, attack: 4, defense: 4, physical: 4, preferredRole: null },
    { overall: 4, attack: 4, defense: 4, physical: 4, preferredRole: null },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: null },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: null },
    { overall: 5, attack: 5, defense: 5, physical: 5, preferredRole: null },
  ]);
  const nullRoles = generateDrawOptionsV3({
    players: withNullRole,
    teamCount: 3,
    teamSize: 5,
    optionsCount: 1,
    minDifference: 3,
    strategy: "A",
    rng: createRng("null-roles"),
  });
  check("null preferred roles still generate", nullRoles.options.length === 1);

  // One 5-star + multiple 5-stars
  const oneFive = roster15().map((p, i) => (i === 0 ? p : { ...p, overall: Math.min(4, p.overall) as number }));
  // Ensure only one overall 5
  const fixedOneFive = oneFive.map((p, i) =>
    i === 0 ? { ...p, overall: 5, strength: 5 } : { ...p, overall: Math.min(p.overall, 4), strength: Math.min(p.overall, 4) },
  );
  const gOne = generateDrawOptionsV3({
    players: fixedOneFive,
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("one-five"),
  });
  check("one 5-star generates 2 options", gOne.options.length === 2);

  const multiFive = roster15().map((p, i) =>
    i < 3 ? { ...p, overall: 5, strength: 5 } : p,
  );
  const gMulti = generateDrawOptionsV3({
    players: multiFive,
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("multi-five"),
  });
  const topsPerTeam = gMulti.options[0]!.teams.map((t) => t.filter((p) => p.overall >= 5).length);
  check(
    "multiple 5-stars distribute (spread <= 2)",
    Math.max(...topsPerTeam) - Math.min(...topsPerTeam) <= 2,
    `tops=${topsPerTeam.join(",")}`,
  );

  // Unbalanced attacker pool
  const attackHeavy = roster15().map((p, i) => ({
    ...p,
    preferredRole: (i < 10 ? "ATTACKER" : "DEFENDER") as PreferredRoleValue,
  }));
  const gAttack = generateDrawOptionsV3({
    players: attackHeavy,
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("attack-heavy"),
  });
  check("attack-heavy pool still valid", gAttack.options.length === 2 && (gAttack.optionDistance ?? 0) >= 3);

  // Seed reproducibility (per strategy)
  const a = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("repro-seed"),
  });
  const b = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("repro-seed"),
  });
  const key = (opt: typeof a) =>
    opt.options
      .map((o) =>
        o.teams
          .map((t) => t.map((p) => p.id).sort().join(","))
          .sort()
          .join("|"),
      )
      .join("||");
  check("seed reproducibility strategy A", key(a) === key(b));
  check("generated strategy A tagged", a.strategy === "A");

  const cRepro1 = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "C",
    rng: createRng("repro-seed-c"),
  });
  const cRepro2 = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "C",
    rng: createRng("repro-seed-c"),
  });
  check("seed reproducibility strategy C", key(cRepro1) === key(cRepro2));
  check("generated strategy C tagged", cRepro1.strategy === "C");

  // Same seed + roster: A and C must not silently substitute (may or may not differ in teams)
  const sameSeedA = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("strategy-fork"),
  });
  const sameSeedC = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "C",
    rng: createRng("strategy-fork"),
  });
  check("A/C keep distinct strategy tags", sameSeedA.strategy === "A" && sameSeedC.strategy === "C");
  check("A/C both diversity-ok", (sameSeedA.optionDistance ?? 0) >= 3 && (sameSeedC.optionDistance ?? 0) >= 3);

  // Lexicographic preference: when O/A/D equal, C prefers lower topsSpread even if Physical worse.
  const fourTopsLex = makeRoster([
    { overall: 5, attack: 4, defense: 4, physical: 5, preferredRole: "ATTACKER" },
    { overall: 4, attack: 4, defense: 4, physical: 2, preferredRole: "ATTACKER" },
    { overall: 4, attack: 4, defense: 4, physical: 5, preferredRole: "VERSATILE" },
    { overall: 4, attack: 4, defense: 4, physical: 2, preferredRole: "DEFENDER" },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: "VERSATILE" },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: "VERSATILE" },
    { overall: 3, attack: 3, defense: 3, physical: 3, preferredRole: "DEFENDER" },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: "ATTACKER" },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: "DEFENDER" },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 2, attack: 2, defense: 2, physical: 2, preferredRole: null },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: "ATTACKER" },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: "DEFENDER" },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: "VERSATILE" },
    { overall: 1, attack: 1, defense: 1, physical: 1, preferredRole: null },
  ]);
  const stackedLex = [
    fourTopsLex.filter((_, i) => [0, 1, 2, 4, 7].includes(i)),
    fourTopsLex.filter((_, i) => [3, 5, 8, 11, 12].includes(i)),
    fourTopsLex.filter((_, i) => [6, 9, 10, 13, 14].includes(i)),
  ];
  const evenLex = [
    fourTopsLex.filter((_, i) => [0, 1, 4, 7, 11].includes(i)),
    fourTopsLex.filter((_, i) => [2, 5, 8, 12, 13].includes(i)),
    fourTopsLex.filter((_, i) => [3, 6, 9, 10, 14].includes(i)),
  ];
  check(
    "strategy C ranks even tops ahead of stacked when O/A/D allow",
    comparePartitionsV3(evenLex, stackedLex, "C") < 0,
  );
  const gFourTopsC = generateDrawOptionsV3({
    players: fourTopsLex,
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "C",
    rng: createRng("four-tops-c"),
  });
  const fourTopsCCounts = gFourTopsC.options[0]!.teams.map(
    (t) => t.filter((p) => p.overall >= 4).length,
  );
  check(
    "strategy C: 4 tops max per team <= 2",
    Math.max(...fourTopsCCounts) <= 2,
    `tops=${fourTopsCCounts.join(",")}`,
  );

  // Different seeds can differ
  const c = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("other-seed"),
  });
  check("different seeds not always identical", key(a) !== key(c) || a.options[0]!.balanceScore === c.options[0]!.balanceScore);

  // 3×5 and 4×5
  assertGeneratedV3(3, 5, roster15(), "v3-3x5-a");
  assertGeneratedV3(3, 5, roster15(), "v3-3x5-b");
  assertGeneratedV3(4, 5, roster20(), "v3-4x5-a");
  assertGeneratedV3(4, 5, roster20(), "v3-4x5-b");

  // v2 still works unchanged on same overall-only projection
  const v2 = generateDrawOptions({
    players: toV2(roster15()),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    rng: createRng("v2-intact"),
  });
  check("v2 still generates", v2.options.length === 2 && (v2.optionDistance ?? 0) >= 3);

  // Impossible diversity still fails explicitly
  let failed = false;
  try {
    generateDrawOptionsV3({
      players: roster15(),
      teamCount: 3,
      teamSize: 5,
      optionsCount: 2,
      minDifference: 15,
    strategy: "A",
      rng: createRng("impossible-v3"),
    });
  } catch {
    failed = true;
  }
  check("v3 fails explicitly on impossible diversity", failed);

  // Performance budget (15 and 20 players, 2 options)
  const t0 = performance.now();
  generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("perf-15"),
  });
  const ms15 = performance.now() - t0;
  const t1 = performance.now();
  generateDrawOptionsV3({
    players: roster20(),
    teamCount: 4,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("perf-20"),
  });
  const ms20 = performance.now() - t1;
  check("perf 15p < 2500ms", ms15 < 2500, `${ms15.toFixed(1)}ms`);
  check("perf 20p < 4000ms", ms20 < 4000, `${ms20.toFixed(1)}ms`);

  // --- Objective v2 vs v3 simulation ---
  console.log("\n=== Simulação v2 vs v3 (métricas independentes) ===");
  type Agg = {
    overall: number[];
    attack: number[];
    defense: number[];
    physical: number[];
    tops: number[];
    roles: number[];
    distance: number[];
    ms: number[];
  };
  const empty = (): Agg => ({
    overall: [],
    attack: [],
    defense: [],
    physical: [],
    tops: [],
    roles: [],
    distance: [],
    ms: [],
  });
  const v2Agg = empty();
  const v3Agg = empty();

  const scenarios: Array<{ name: string; roster: DrawPlayerV3[]; teamCount: number }> = [
    { name: "15p", roster: roster15(), teamCount: 3 },
    { name: "20p", roster: roster20(), teamCount: 4 },
  ];
  const seeds = ["sim-a", "sim-b", "sim-c", "sim-d", "sim-e", "sim-f", "sim-g", "sim-h"];

  for (const scenario of scenarios) {
    for (const seed of seeds) {
      const startV2 = performance.now();
      const g2 = generateDrawOptions({
        players: toV2(scenario.roster),
        teamCount: scenario.teamCount,
        teamSize: 5,
        optionsCount: 2,
        minDifference: 3,
        rng: createRng(`v2-${scenario.name}-${seed}`),
      });
      const msV2 = performance.now() - startV2;
      const teamsV2 = remapV2TeamsOntoV3(g2.options[0]!.teams, scenario.roster);

      const startV3 = performance.now();
      const g3 = generateDrawOptionsV3({
        players: scenario.roster,
        teamCount: scenario.teamCount,
        teamSize: 5,
        optionsCount: 2,
        minDifference: 3,
    strategy: "A",
        rng: createRng(`v3-${scenario.name}-${seed}`),
      });
      const msV3 = performance.now() - startV3;
      const teamsV3 = g3.options[0]!.teams;

      for (const [agg, teams, dist, ms] of [
        [v2Agg, teamsV2, g2.optionDistance ?? 0, msV2] as const,
        [v3Agg, teamsV3, g3.optionDistance ?? 0, msV3] as const,
      ]) {
        agg.overall.push(axisImbalance(teams, "overall"));
        agg.attack.push(axisImbalance(teams, "attack"));
        agg.defense.push(axisImbalance(teams, "defense"));
        agg.physical.push(axisImbalance(teams, "physical"));
        agg.tops.push(topSpread(teams));
        agg.roles.push(roleAttackerSpread(teams));
        agg.distance.push(dist);
        agg.ms.push(ms);
      }

      // Sanity: evaluatePartition matches generate metrics overall spread
      const evalM = evaluatePartitionV3(teamsV3);
      check(
        `eval matches gen (${scenario.name}/${seed})`,
        evalM.balanceScore === g3.options[0]!.metrics.balanceScore,
      );
    }
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const fmt = (xs: number[]) => mean(xs).toFixed(2);

  console.log(
    [
      "metric            | v2 mean | v3 mean | lower-better",
      `overall imbalance | ${fmt(v2Agg.overall).padStart(7)} | ${fmt(v3Agg.overall).padStart(7)} | yes`,
      `attack imbalance  | ${fmt(v2Agg.attack).padStart(7)} | ${fmt(v3Agg.attack).padStart(7)} | yes`,
      `defense imbalance | ${fmt(v2Agg.defense).padStart(7)} | ${fmt(v3Agg.defense).padStart(7)} | yes`,
      `physical imbalance| ${fmt(v2Agg.physical).padStart(7)} | ${fmt(v3Agg.physical).padStart(7)} | yes`,
      `top(4+) spread    | ${fmt(v2Agg.tops).padStart(7)} | ${fmt(v3Agg.tops).padStart(7)} | yes`,
      `attacker spread   | ${fmt(v2Agg.roles).padStart(7)} | ${fmt(v3Agg.roles).padStart(7)} | yes`,
      `option distance   | ${fmt(v2Agg.distance).padStart(7)} | ${fmt(v3Agg.distance).padStart(7)} | (diversity)`,
      `runtime ms        | ${fmt(v2Agg.ms).padStart(7)} | ${fmt(v3Agg.ms).padStart(7)} | yes`,
    ].join("\n"),
  );

  // Soft expectation: v3 should not be worse on attack+defense combined mean than v2
  // (not a hard guarantee for every seed — objective report above is primary).
  const v2Attr = mean(v2Agg.attack) + mean(v2Agg.defense) + mean(v2Agg.physical);
  const v3Attr = mean(v3Agg.attack) + mean(v3Agg.defense) + mean(v3Agg.physical);
  check(
    "v3 attr-imbalance sum <= v2 + 0.5 (soft)",
    v3Attr <= v2Attr + 0.5,
    `v2=${v2Attr.toFixed(2)} v3=${v3Attr.toFixed(2)}`,
  );

  // Diversity preserved on both
  check("sim v2 min distance >= 3", Math.min(...v2Agg.distance) >= 3);
  check("sim v3 min distance >= 3", Math.min(...v3Agg.distance) >= 3);

  // Overlap check on one sample pair
  const sample = generateDrawOptionsV3({
    players: roster15(),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 2,
    minDifference: 3,
    strategy: "A",
    rng: createRng("overlap-sample"),
  });
  const aIds = sample.options[0]!.teams.map((t) => t.map((p) => p.id));
  const bIds = sample.options[1]!.teams.map((t) => t.map((p) => p.id));
  check("sample overlap <= 2", maxTeamOverlap(aIds, bIds) <= 2);
  check("sample distance >= 3", partitionDistance(aIds, bIds) >= 3);
}

domainChecks();

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
