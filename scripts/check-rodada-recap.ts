// Regressão pura dos agregados da Rodada (placar, H2H, campeão com desempates, stats).
//
//   npm run check:rodada-recap
import {
  aggregateSessionPlayerStats,
  buildHeadToHeadMatrix,
  buildTeamStandings,
  countHeadToHeadWinsAmong,
  countTeamWins,
  resolveRodadaChampion,
  type RodadaFinishedMatchInput,
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

function teamRefs(teams: typeof teams3 | typeof teams4) {
  return teams.map((team) => ({ id: team.id, name: team.name }));
}

function match(
  partial: Omit<RodadaFinishedMatchInput, "penaltyWinnerTeamId"> & {
    penaltyWinnerTeamId?: string | null;
  },
): RodadaFinishedMatchInput {
  return { penaltyWinnerTeamId: null, ...partial };
}

{
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 2, scoreB: 1 }),
    match({
      id: "m2",
      sequence: 2,
      teamAId: "t1",
      teamBId: "t3",
      scoreA: 0,
      scoreB: 0,
      penaltyWinnerTeamId: "t1",
    }),
  ];
  const standings = buildTeamStandings(teams3, matches);
  const preto = standings.find((row) => row.teamId === "t1");
  check(
    "3 times: standings GF/GA/V (pênaltis não inflacionam gols)",
    !!preto &&
      preto.wins === 2 &&
      preto.goalsFor === 2 &&
      preto.goalsAgainst === 1 &&
      preto.goalDifference === 1 &&
      preto.points === 6,
  );
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "clear wins leader",
    champion.kind === "determined" &&
      champion.teamId === "t1" &&
      champion.wins === 2 &&
      champion.decidedBy === "wins" &&
      champion.reason === "Campeão pelas vitórias",
  );
}

{
  // Empate em vitórias; t1 melhor saldo.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 3, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t3", teamBId: "t1", scoreA: 1, scoreB: 0 }),
  ];
  // t1:1W GD+2 GF3; t2:1W GD-2 GF1; t3:1W GD0 GF1
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "tied wins resolved by goal difference",
    champion.kind === "determined" &&
      champion.teamId === "t1" &&
      champion.decidedBy === "goalDifference" &&
      champion.reason === "Campeão pelo saldo de gols" &&
      champion.goalDifference === 2,
  );
}

{
  // Empate V e SG; t2 mais gols marcados.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t2", teamBId: "t3", scoreA: 2, scoreB: 1 }),
  ];
  // t1:1W GF1 GA0 GD+1; t2:1W GF2 GA1 GD+1; t3:0W
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "tied goal difference resolved by goals scored",
    champion.kind === "determined" &&
      champion.teamId === "t2" &&
      champion.decidedBy === "goalsFor" &&
      champion.reason === "Campeão pelos gols marcados" &&
      champion.goalsFor === 2,
  );
}

{
  // Empate V/SG/GF entre t1 e t2; confronto direto (todos os encontros) decide.
  // t1 vence t2 duas vezes; t2 compensa com duas vitórias sobre t3; t1 perde feio para t3
  // para igualar GF/GA — líderes ficam 2V, SG 0, GP 2.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m4", sequence: 4, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m5", sequence: 5, teamAId: "t3", teamBId: "t1", scoreA: 2, scoreB: 0 }),
  ];
  const h2h = countHeadToHeadWinsAmong(["t1", "t2"], matches);
  check("H2H aggregates all direct encounters", h2h.get("t1") === 2 && h2h.get("t2") === 0);
  const standings = buildTeamStandings(teams3, matches);
  const t1 = standings.find((row) => row.teamId === "t1");
  const t2 = standings.find((row) => row.teamId === "t2");
  check(
    "H2H fixture: leaders tied on V/SG/GF before H2H",
    !!t1 &&
      !!t2 &&
      t1.wins === 2 &&
      t2.wins === 2 &&
      t1.goalDifference === 0 &&
      t2.goalDifference === 0 &&
      t1.goalsFor === 2 &&
      t2.goalsFor === 2,
  );
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "tied goals resolved by head-to-head",
    champion.kind === "determined" &&
      champion.teamId === "t1" &&
      champion.decidedBy === "headToHead" &&
      champion.reason === "Campeão pelo confronto direto",
  );
}

{
  // Ciclo completo: V/SG/GF iguais e H2H 1–1 (ou sem vantagem).
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t3", teamBId: "t1", scoreA: 1, scoreB: 0 }),
  ];
  // cada 1W, GF1 GA1 GD0; H2H cada 1 vitória no ciclo → empate
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "complete tie → Empate na liderança",
    champion.kind === "tied" &&
      champion.reason === "Empate na liderança" &&
      champion.wins === 1 &&
      champion.teamIds.length === 3 &&
      champion.teamIds.join(",") === "t1,t2,t3",
  );
}

{
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: [] });
  check("no completed matches → Indeterminado", champion.kind === "undetermined");
}

{
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 1 }),
    match({ id: "m2", sequence: 2, teamAId: "t3", teamBId: "t4", scoreA: 2, scoreB: 2 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams4), finished: matches });
  check("draws only → Indeterminado (sem vitórias)", champion.kind === "undetermined");
  const standings = buildTeamStandings(teams4, matches);
  check(
    "4 times: empate conta como E nos dois",
    standings.filter((row) => row.draws === 1).length === 4,
  );
}

{
  const matches = [
    match({
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 0,
      scoreB: 0,
      penaltyWinnerTeamId: "t2",
    }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "penalty win counts as victory without inflating GF",
    champion.kind === "determined" &&
      champion.teamId === "t2" &&
      champion.wins === 1 &&
      champion.goalsFor === 0 &&
      champion.goalDifference === 0,
  );
  const standings = buildTeamStandings(teams3, matches);
  const branco = standings.find((row) => row.teamId === "t2");
  check(
    "penalty shootout goals do not inflate standings GF/GA",
    !!branco && branco.goalsFor === 0 && branco.goalsAgainst === 0 && branco.wins === 1,
  );
}

{
  // 4 times: t1 e t4 empatam em V; t1 melhor SG.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 4, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t4", teamBId: "t3", scoreA: 1, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams4), finished: matches });
  check(
    "4-team session: GD tiebreak among win leaders",
    champion.kind === "determined" &&
      champion.teamId === "t1" &&
      champion.decidedBy === "goalDifference" &&
      champion.wins === 1,
  );
}

{
  // Unfinished matches are never passed into resolveRodadaChampion — only FINISHED inputs.
  const finishedOnly = [
    match({ id: "m1", sequence: 1, teamAId: "t2", teamBId: "t3", scoreA: 3, scoreB: 0 }),
  ];
  const wins = countTeamWins(teamRefs(teams3), finishedOnly);
  check("unfinished excluded: only FINISHED wins counted", wins.get("t2") === 1 && wins.get("t1") === 0);
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: finishedOnly });
  check(
    "unfinished excluded: champion from FINISHED only",
    champion.kind === "determined" && champion.teamId === "t2",
  );
}

{
  // Last match winner is t3, but t1 has more wins — must NOT use last-match rule.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t1", teamBId: "t3", scoreA: 2, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t3", teamBId: "t2", scoreA: 1, scoreB: 0 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "never last-match winner: t1 (2V) beats last winner t3",
    champion.kind === "determined" &&
      champion.teamId === "t1" &&
      champion.wins === 2 &&
      champion.decidedBy === "wins",
  );
}

{
  // Resultado incompleto: placar empatado + penaltyWinner inválido → individualResult null.
  const matches = [
    match({
      id: "m1",
      sequence: 1,
      teamAId: "t1",
      teamBId: "t2",
      scoreA: 1,
      scoreB: 1,
      penaltyWinnerTeamId: "ghost",
    }),
    match({ id: "m2", sequence: 2, teamAId: "t1", teamBId: "t3", scoreA: 2, scoreB: 0 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "incomplete match results handled safely (invalid penalty ignored)",
    champion.kind === "determined" && champion.teamId === "t1" && champion.wins === 1,
  );
  const standings = buildTeamStandings(teams3, matches);
  const row = standings.find((r) => r.teamId === "t1");
  check(
    "incomplete result does not invent W/D/L for bad penalty row",
    !!row && row.wins === 1 && row.draws === 0 && row.played === 2,
  );
}

{
  // Times desconhecidos no placar são ignorados com segurança.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "ghostA", teamBId: "ghostB", scoreA: 5, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t2", teamBId: "t3", scoreA: 1, scoreB: 0 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "unknown team IDs in matches skipped safely",
    champion.kind === "determined" && champion.teamId === "t2",
  );
}

{
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 3, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 2 }),
  ];
  const matrix = buildHeadToHeadMatrix(teams3.slice(0, 2), matches);
  const cell = matrix.cells.find((row) => row.rowTeamId === "t1" && row.colTeamId === "t2");
  check(
    "H2H matrix ainda usa o confronto mais recente (UI)",
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

{
  // Critérios aplicados só aos ainda empatados: t3 tem melhor SG geral mas menos vitórias.
  const matches = [
    match({ id: "m1", sequence: 1, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m2", sequence: 2, teamAId: "t1", teamBId: "t2", scoreA: 1, scoreB: 0 }),
    match({ id: "m3", sequence: 3, teamAId: "t3", teamBId: "t2", scoreA: 8, scoreB: 0 }),
  ];
  const champion = resolveRodadaChampion({ teams: teamRefs(teams3), finished: matches });
  check(
    "tiebreakers only among win leaders (t3 GD ignored)",
    champion.kind === "determined" && champion.teamId === "t1" && champion.decidedBy === "wins",
  );
}

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
