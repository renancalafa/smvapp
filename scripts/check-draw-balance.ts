// SOMENTE DESENVOLVIMENTO: regressão pura de diversidade do sorteio
// (partitionDistance + maxTeamOverlap ≤ 40%).
//
//   npm run check:draw-balance
import {
  DrawGenerationError,
  generateDrawOptions,
  type DrawPlayer,
} from "../src/domain/draw/balance";
import {
  maxAllowedTeamOverlap,
  maxTeamOverlap,
  partitionDistance,
} from "../src/domain/draw/partition";
import { createRng } from "../src/domain/draw/random";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function players(count: number, strengths?: number[]): DrawPlayer[] {
  const ratings = strengths ?? [5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 5, 4, 3, 3, 2, 2, 1, 4];
  return Array.from({ length: count }, (_, index) => ({
    id: `p${String(index + 1).padStart(2, "0")}`,
    strength: ratings[index % ratings.length],
  }));
}

function assertGenerated(teamCount: number, teamSize: number, seed: string) {
  const maxOverlap = maxAllowedTeamOverlap(teamSize);
  if (maxOverlap === null) throw new Error("assertGenerated exige teamSize >= 5");
  const generated = generateDrawOptions({
    players: players(teamCount * teamSize),
    teamCount,
    teamSize,
    optionsCount: 2,
    minDifference: 3,
    rng: createRng(seed),
  });
  const a = generated.options[0].teams.map((team) => team.map((player) => player.id));
  const b = generated.options[1].teams.map((team) => team.map((player) => player.id));
  const distance = partitionDistance(a, b);
  const overlap = maxTeamOverlap(a, b);
  check(
    `${teamCount}×${teamSize} (${seed}): optionDistance >= 3`,
    (generated.optionDistance ?? 0) >= 3 && distance >= 3,
    `distance=${distance}`,
  );
  check(
    `${teamCount}×${teamSize} (${seed}): maxTeamOverlap <= ${maxOverlap}`,
    (generated.maxTeamOverlap ?? 99) <= maxOverlap && overlap <= maxOverlap,
    `maxOverlap=${overlap} reported=${generated.maxTeamOverlap}`,
  );
  check(
    `${teamCount}×${teamSize} (${seed}): reporta maxTeamOverlap=${overlap}`,
    generated.maxTeamOverlap === overlap,
  );
  // Mesmos jogadores, sem duplicata dentro da opção.
  const flatA = a.flat().sort();
  const flatB = b.flat().sort();
  check(
    `${teamCount}×${teamSize} (${seed}): mesmos jogadores nas opções`,
    flatA.join(",") === flatB.join(",") && new Set(flatA).size === flatA.length,
  );
  return { overlap, distance };
}

function domainChecks() {
  check("maxAllowedTeamOverlap(5) = 2", maxAllowedTeamOverlap(5) === 2);
  check("maxAllowedTeamOverlap(2) = null (só distância)", maxAllowedTeamOverlap(2) === null);

  // Bloco de 3 juntos em A e B: inválido para o teto de 40% (mesmo com d alta).
  const optionA = [
    ["a", "b", "c", "d", "e"],
    ["f", "g", "h", "i", "j"],
    ["k", "l", "m", "n", "o"],
  ];
  const optionB = [
    ["a", "b", "c", "f", "g"],
    ["d", "h", "i", "k", "l"],
    ["e", "j", "m", "n", "o"],
  ];
  check("maxTeamOverlap detecta bloco de 3", maxTeamOverlap(optionA, optionB) === 3);
  check(
    "partitionDistance pode ser alta mesmo com bloco de 3",
    partitionDistance(optionA, optionB) >= 3,
    `d=${partitionDistance(optionA, optionB)}`,
  );

  // Recoloração / mesma partição: d=0, overlap=5.
  const recolored = [
    ["k", "l", "m", "n", "o"],
    ["a", "b", "c", "d", "e"],
    ["f", "g", "h", "i", "j"],
  ];
  check("recoloração: distance 0", partitionDistance(optionA, recolored) === 0);
  check("recoloração: maxTeamOverlap 5", maxTeamOverlap(optionA, recolored) === 5);

  // Par válido: nenhum time compartilha mais de 2.
  const optionValidB = [
    ["a", "b", "f", "k", "l"],
    ["c", "d", "g", "h", "m"],
    ["e", "i", "j", "n", "o"],
  ];
  check("par válido: maxTeamOverlap <= 2", maxTeamOverlap(optionA, optionValidB) <= 2);
  check("par válido: distance >= 3", partitionDistance(optionA, optionValidB) >= 3);

  const three = assertGenerated(3, 5, "overlap-3x5-a");
  const threeB = assertGenerated(3, 5, "overlap-3x5-b");
  const four = assertGenerated(4, 5, "overlap-4x5-a");
  const fourB = assertGenerated(4, 5, "overlap-4x5-b");
  console.log(
    `max overlaps gerados: 3×5 → ${three.overlap}, ${threeB.overlap}; 4×5 → ${four.overlap}, ${fourB.overlap}`,
  );

  // Uma opção: sem distância/overlap cruzado.
  const single = generateDrawOptions({
    players: players(15),
    teamCount: 3,
    teamSize: 5,
    optionsCount: 1,
    minDifference: 3,
    rng: createRng("single-option"),
  });
  check("1 opção: optionDistance null", single.optionDistance === null);
  check("1 opção: maxTeamOverlap null", single.maxTeamOverlap === null);

  // Orçamento impossível: minDifference absurdo + overlap — falha explícita.
  let failed = false;
  let message = "";
  try {
    generateDrawOptions({
      players: players(15),
      teamCount: 3,
      teamSize: 5,
      optionsCount: 2,
      minDifference: 15,
      rng: createRng("impossible-diff"),
    });
  } catch (error) {
    failed = error instanceof DrawGenerationError;
    message = error instanceof Error ? error.message : String(error);
  }
  check("falha explícita quando não há par válido", failed);
  check(
    "mensagem menciona sobreposição ou diferença",
    /diferença mínima|sobreposição/i.test(message),
    message,
  );
}

domainChecks();

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
