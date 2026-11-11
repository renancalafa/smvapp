// Regressão pura dos agregados da Rodada (placar, H2H, campeão, stats).
//
//   npm run check:rodada-recap
import {
  aggregateSessionPlayerStats,
  buildHeadToHeadMatrix,
  buildTeamStandings,
  resolveRodadaChampion,
} from "../src/domain/rodada/recap";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const teams3 = [
  { id: "t1", name: "Preto", color: "#111", kind: "REGULAR" as const, initialQueuePosition: 1 },
  { id: "t2", name: "Branco", color: "#eee", kind: "REGULAR" as const, initialQueuePosition: 2 },
  { id: "t3", name: "Verde", color: "#0a0", kind: "REGULAR" as const, initialQueuePosition: 3 },
];

const teams4 = [
  ...teams3,
  { id: "t4", name: "Azul", color: "#00f", kind: "REGULAR" as const, initialQueuePosition: 4 },
];

{
  const matches = [
    {
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 2,
      scoreB: 1,
      penaltyWinnerTeamId: null,
    },
    {
      id: "m2",
      sequence: 2,
      teamAId: "t1",
      teamBId: "t3",
      scoreA: 0,
      scoreB: 0,
      penaltyWinnerTeamId: "t1",
    },
  ];
  const standings = buildTeamStandings(teams3, matches);
  const preto = standings.find((row) => row.teamId === "t1");
  check(
    "3 times: standings GF/GA/V",
    !!preto && preto.wins === 2 && preto.goalsFor === 2 && preto.goalsAgainst === 1 && preto.points === 6,
  );
  const champion = resolveRodadaChampion({
    regularTeams: teams3.map((team) => ({
      id: team.id,
      name: team.name,
      initialQueuePosition: team.initialQueuePosition!,
    })),
    finished: matches,
  });
  check(
    "3 times com histórico claro ainda → campeão indeterminado (sem campo oficial)",
    champion.kind === "undetermined",
  );
}

{
  const matches = [
    {
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 1,
      scoreB: 1,
      penaltyWinnerTeamId: null,
    },
  ];
  const champion = resolveRodadaChampion({
    regularTeams: teams4.map((team) => ({
      id: team.id,
      name: team.name,
      initialQueuePosition: team.initialQueuePosition!,
    })),
    finished: matches,
  });
  check("4 times: campeão indeterminado", champion.kind === "undetermined");
  const standings = buildTeamStandings(teams4, matches);
  check(
    "4 times: empate conta como E nos dois",
    standings.filter((row) => row.draws === 1).length === 2,
  );
}

{
  const champion = resolveRodadaChampion({
    regularTeams: teams3.map((team) => ({
      id: team.id,
      name: team.name,
      initialQueuePosition: team.initialQueuePosition!,
    })),
    finished: [],
  });
  check("sem partidas → campeão indeterminado", champion.kind === "undetermined");
}

{
  const matches = [
    {
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 3,
      scoreB: 0,
      penaltyWinnerTeamId: null,
    },
    {
      id: "m2",
      sequence: 2,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 1,
      scoreB: 2,
      penaltyWinnerTeamId: null,
    },
  ];
  const matrix = buildHeadToHeadMatrix(teams3.slice(0, 2), matches);
  const cell = matrix.cells.find((row) => row.rowTeamId === "t1" && row.colTeamId === "t2");
  check(
    "H2H usa o confronto mais recente (sequence)",
    !!cell?.score && cell.score.for === 1 && cell.score.against === 2,
  );
  const empty = matrix.cells.find((row) => row.rowTeamId === "t1" && row.colTeamId === "t1");
  check("H2H diagonal nula", empty?.score === null);
}

{
  const stats = aggregateSessionPlayerStats({
    members: [
      { memberId: "p1", name: "Ana", nickname: null },
      { memberId: "p2", name: "Beto", nickname: "B" },
    ],
    events: [
      {
        type: "GOAL",
        memberId: "p1",
        assistMemberId: "p2",
        voidedAt: null,
      },
      {
        type: "BIG_MISS",
        memberId: "p2",
        assistMemberId: null,
        voidedAt: null,
      },
      {
        type: "OWN_GOAL",
        memberId: "p1",
        assistMemberId: null,
        voidedAt: null,
      },
      {
        type: "GOAL",
        memberId: "p2",
        assistMemberId: null,
        voidedAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    ],
    appearances: [],
    matchResults: [],
  });
  const ana = stats.find((row) => row.memberId === "p1");
  const beto = stats.find((row) => row.memberId === "p2");
  check(
    "stats: gols / assistência / pixotada / gol contra; anulado ignorado",
    !!ana &&
      !!beto &&
      ana.totals.goals === 1 &&
      ana.totals.ownGoals === 1 &&
      beto.totals.assists === 1 &&
      beto.totals.bigMisses === 1 &&
      beto.totals.goals === 0,
  );
}

{
  const incomplete = buildTeamStandings(teams3, []);
  check(
    "sem partidas: standings zerados (não inventa)",
    incomplete.length === 3 && incomplete.every((row) => row.played === 0 && row.points === 0),
  );
}

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
