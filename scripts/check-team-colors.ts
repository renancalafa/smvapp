// Estabilidade das camisas Branco/Azul/Preto/Vermelho via posição (não UUID).
//
//   npm run check:team-colors
import {
  drawTeamIdentity,
  jerseyForPosition,
  resolveTeamDisplay,
  TEAM_JERSEYS,
} from "../src/domain/team/colors";
import {
  buildRodadaHighlights,
  buildTeamStandings,
  resolveRodadaChampion,
  type RodadaFinishedMatchInput,
  type RodadaPlayerStatRow,
} from "../src/domain/rodada/recap";
import { emptyTotals } from "../src/domain/stats/aggregate";

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

{
  check("posição 1 → Branco", jerseyForPosition(1)?.name === "Branco");
  check("posição 2 → Azul", jerseyForPosition(2)?.name === "Azul");
  check("posição 3 → Preto", jerseyForPosition(3)?.name === "Preto");
  check("posição 4 → Vermelho", jerseyForPosition(4)?.name === "Vermelho");
  check("posição inválida → null", jerseyForPosition(5) === null && jerseyForPosition(null) === null);
}

{
  const a = drawTeamIdentity(1);
  const b = drawTeamIdentity(2);
  check("draw write Branco + hex", a.name === "Branco" && a.color === TEAM_JERSEYS[1].hex);
  check("draw write Azul + hex", b.name === "Azul" && b.color === TEAM_JERSEYS[2].hex);
  check("hexes distintos", new Set([1, 2, 3, 4].map((p) => TEAM_JERSEYS[p as 1|2|3|4].hex)).size === 4);
}

{
  // Legado: nome "Time N" + color null → resolve pela posição estável.
  const legacy = resolveTeamDisplay({
    name: "Time 1",
    color: null,
    kind: "REGULAR",
    position: 1,
  });
  check("legado Time 1 → Branco", legacy.displayName === "Branco" && legacy.colorHex === TEAM_JERSEYS[1].hex);

  const legacy3 = resolveTeamDisplay({
    name: "Time 3",
    color: null,
    kind: "REGULAR",
    position: 3,
  });
  check("legado Time 3 → Preto", legacy3.displayName === "Preto");

  const threeOnly = resolveTeamDisplay({
    name: "Time 4",
    color: null,
    kind: "REGULAR",
    position: null,
  });
  check("sem posição não inventa Vermelho", threeOnly.displayName === "Time 4");

  const pool = resolveTeamDisplay({
    name: "Rotativos",
    color: null,
    kind: "ROTATION_POOL",
    position: null,
  });
  check("ROTATION_POOL permanece Rotativos", pool.displayName === "Rotativos" && pool.jersey === null);

  // Não depende de ordem de IDs: posição 4 é Vermelho mesmo com id "aaa".
  const byPos = resolveTeamDisplay({
    name: "Time 4",
    color: null,
    kind: "REGULAR",
    position: 4,
  });
  check("posição 4 → Vermelho independente do id", byPos.displayName === "Vermelho");
}

{
  // Sessão histórica com 3 times: só posições 1–3.
  const teams = [
    { id: "t1", name: "Time 1", color: null, kind: "REGULAR" as const, initialQueuePosition: 1 },
    { id: "t2", name: "Time 2", color: null, kind: "REGULAR" as const, initialQueuePosition: 2 },
    { id: "t3", name: "Time 3", color: null, kind: "REGULAR" as const, initialQueuePosition: 3 },
  ].map((team) => {
    const display = resolveTeamDisplay({
      name: team.name,
      color: team.color,
      kind: team.kind,
      position: team.initialQueuePosition,
    });
    return { ...team, name: display.displayName, color: display.colorHex };
  });
  check(
    "3 times: Branco/Azul/Preto",
    teams.map((t) => t.name).join(",") === "Branco,Azul,Preto",
  );

  const matches: RodadaFinishedMatchInput[] = [
    {
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 2,
      scoreB: 0,
      penaltyWinnerTeamId: null,
    },
  ];
  const standings = buildTeamStandings(teams, matches);
  check("ranking: 1º Branco por vitórias", standings[0]?.name === "Branco" && standings[0]?.rank === 1);
  check("ranking sem inventar empate", standings[0]?.rankTied === false);
}

{
  // Empate total: mesmo rank, sem ordem definitiva inventada.
  const teams = [
    { id: "t1", name: "Branco", color: "#fff", kind: "REGULAR" as const, initialQueuePosition: 1 },
    { id: "t2", name: "Azul", color: "#00f", kind: "REGULAR" as const, initialQueuePosition: 2 },
    { id: "t3", name: "Preto", color: "#000", kind: "REGULAR" as const, initialQueuePosition: 3 },
  ];
  const matches: RodadaFinishedMatchInput[] = [
    {
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 1,
      scoreB: 0,
      penaltyWinnerTeamId: null,
    },
    {
      id: "m2",
      sequence: 2,
      teamAId: "t2",
      teamBId: "t3",
      scoreA: 1,
      scoreB: 0,
      penaltyWinnerTeamId: null,
    },
    {
      id: "m3",
      sequence: 3,
      teamAId: "t3",
      teamBId: "t1",
      scoreA: 1,
      scoreB: 0,
      penaltyWinnerTeamId: null,
    },
  ];
  const standings = buildTeamStandings(teams, matches);
  const champion = resolveRodadaChampion({
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    finished: matches,
  });
  check(
    "empate total: ranks iguais",
    standings.every((row) => row.rank === 1 && row.rankTied) && champion.kind === "tied",
  );
}

{
  const highlights = buildRodadaHighlights([]);
  check("highlights sem stats → value null", highlights.every((h) => h.value === null));

  const withGoals: RodadaPlayerStatRow[] = [
    {
      memberId: "p1",
      name: "Ana",
      nickname: null,
      totals: { ...emptyTotals(), goals: 3, assists: 1, bigMisses: 2, ownGoals: 0 },
    },
    {
      memberId: "p2",
      name: "Beto",
      nickname: "B",
      totals: { ...emptyTotals(), goals: 3, assists: 0, bigMisses: 2, ownGoals: 1 },
    },
    {
      memberId: "p3",
      name: "Caio",
      nickname: null,
      totals: { ...emptyTotals(), goals: 0, assists: 0, bigMisses: 1, ownGoals: 3 },
    },
  ];
  const h = buildRodadaHighlights(withGoals);
  const art = h.find((x) => x.kind === "artilheiro");
  const pereba = h.find((x) => x.kind === "pereba");
  check("artilheiro empate em gols", !!art && art.leaders.length === 2 && art.value === 3);
  check(
    "pereba: pixotadas first, own goals tiebreak",
    !!pereba &&
      pereba.leaders.length === 1 &&
      pereba.leaders[0]?.memberId === "p2" &&
      pereba.detail === "1 gol contra · 2 pixotadas",
  );
  check("no xerife highlight", h.every((x) => x.kind !== ("xerife" as string)));
}

{
  const onlyOwnGoals: RodadaPlayerStatRow[] = [
    {
      memberId: "p1",
      name: "Ana",
      nickname: null,
      totals: { ...emptyTotals(), ownGoals: 4 },
    },
  ];
  const h = buildRodadaHighlights(onlyOwnGoals);
  const pereba = h.find((x) => x.kind === "pereba");
  check(
    "pereba requires pixotadas (own goals alone do not qualify)",
    !!pereba && pereba.value === null,
  );
}

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
