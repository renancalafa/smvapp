// Regressão do Histórico: agrupamento, latest global, gols, campeão, duração.
//
//   npm run check:historico
import {
  buildHistoricoDurationSeries,
  collectHistoricoYears,
  groupHistoricoByMonth,
  sessionInCivilYear,
  summarizeHistoricoSession,
  type HistoricoSessionInput,
} from "../src/domain/historico/archive";
import { selectLatestFinishedSession } from "../src/domain/nav/night-mode";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function session(partial: {
  id: string;
  startsAt: string;
  finishedAt?: string | null;
  teams?: HistoricoSessionInput["teams"];
  matches?: HistoricoSessionInput["matches"];
}): HistoricoSessionInput {
  const teams = partial.teams ?? [
    { id: "t1", name: "Time 1", color: null, kind: "REGULAR", initialQueuePosition: 1 },
    { id: "t2", name: "Time 2", color: null, kind: "REGULAR", initialQueuePosition: 2 },
    { id: "t3", name: "Time 3", color: null, kind: "REGULAR", initialQueuePosition: 3 },
  ];
  return {
    id: partial.id,
    startsAt: new Date(partial.startsAt),
    finishedAt: partial.finishedAt === undefined ? new Date(partial.startsAt) : partial.finishedAt ? new Date(partial.finishedAt) : null,
    teams,
    matches: partial.matches ?? [],
  };
}

{
  const tz = "America/Sao_Paulo";
  const years = collectHistoricoYears(
    [
      { startsAt: new Date("2025-12-15T23:00:00.000Z") },
      { startsAt: new Date("2026-01-10T23:00:00.000Z") },
      { startsAt: new Date("2026-06-01T22:00:00.000Z") },
    ],
    tz,
  );
  check("anos distintos desc", years[0] === 2026 && years.includes(2025) && years.length === 2);
  check(
    "filtro ano usa fuso do grupo",
    sessionInCivilYear(new Date("2025-12-15T23:00:00.000Z"), 2025, tz) &&
      !sessionInCivilYear(new Date("2025-12-15T23:00:00.000Z"), 2026, tz),
  );
}

{
  const latest = selectLatestFinishedSession([
    {
      id: "old-start-new-finish",
      status: "FINISHED",
      finishedAtMs: Date.parse("2026-11-01T02:00:00.000Z"),
    },
    {
      id: "new-start-old-finish",
      status: "FINISHED",
      finishedAtMs: Date.parse("2026-10-02T02:00:00.000Z"),
    },
    {
      id: "unfinished",
      status: "IN_PROGRESS",
      finishedAtMs: null,
    },
  ]);
  check(
    "latest global usa finishedAt (não startsAt)",
    latest?.id === "old-start-new-finish",
  );
}

{
  const tz = "America/Sao_Paulo";
  const fourTeams = [
    { id: "t1", name: "Time 1", color: null, kind: "REGULAR" as const, initialQueuePosition: 1 },
    { id: "t2", name: "Time 2", color: null, kind: "REGULAR" as const, initialQueuePosition: 2 },
    { id: "t3", name: "Time 3", color: null, kind: "REGULAR" as const, initialQueuePosition: 3 },
    { id: "t4", name: "Time 4", color: null, kind: "REGULAR" as const, initialQueuePosition: 4 },
  ];

  const withGoals = session({
    id: "s-goals",
    startsAt: "2026-03-05T23:00:00.000Z",
    finishedAt: "2026-03-06T01:30:00.000Z",
    teams: fourTeams,
    matches: [
      {
        id: "m1",
        sequence: 2,
        teamAId: "t1",
        teamBId: "t2",
        teamAName: "A",
        teamBName: "B",
        penaltyWinnerTeamId: null,
        events: [
          { type: "GOAL", teamId: "t1", memberId: "p1", assistMemberId: null, voidedAt: null },
          { type: "GOAL", teamId: "t1", memberId: "p1", assistMemberId: null, voidedAt: null },
          { type: "OWN_GOAL", teamId: "t1", memberId: "p2", assistMemberId: null, voidedAt: null },
          { type: "GOAL", teamId: "t2", memberId: "p3", assistMemberId: null, voidedAt: new Date() },
        ],
      },
      {
        id: "m2",
        sequence: 1,
        teamAId: "t3",
        teamBId: "t4",
        teamAName: "C",
        teamBName: "D",
        penaltyWinnerTeamId: "t4",
        events: [
          { type: "GOAL", teamId: "t3", memberId: "p4", assistMemberId: null, voidedAt: null },
          { type: "GOAL", teamId: "t4", memberId: "p5", assistMemberId: null, voidedAt: null },
        ],
      },
    ],
  });

  const summary = summarizeHistoricoSession(withGoals, tz, "s-goals");
  check("gols válidos ignoram OWN_GOAL e anulados", summary.totalGoals === 4);
  check(
    "tiles ordenados por sequence",
    summary.matches[0]!.sequence === 1 && summary.matches[1]!.sequence === 2,
  );
  check(
    "pênaltis não inflacionam placar",
    summary.matches[0]!.scoreA === 1 &&
      summary.matches[0]!.scoreB === 1 &&
      summary.matches[0]!.penaltyWinnerTeamId === "t4",
  );
  check("cores canônicas por posição", summary.teams[0]!.name === "Branco" && summary.teams[1]!.name === "Azul");
  check("destaque global marcado por id", summary.isGlobalLatest === true);
  check(
    "não marca latest em outra sessão",
    summarizeHistoricoSession(withGoals, tz, "other").isGlobalLatest === false,
  );
}

{
  const tz = "America/Sao_Paulo";
  const threeTeams = [
    { id: "t1", name: "Time 1", color: null, kind: "REGULAR" as const, initialQueuePosition: 1 },
    { id: "t2", name: "Time 2", color: null, kind: "REGULAR" as const, initialQueuePosition: 2 },
    { id: "t3", name: "Time 3", color: null, kind: "REGULAR" as const, initialQueuePosition: 3 },
  ];
  const tied = summarizeHistoricoSession(
    session({
      id: "tied",
      startsAt: "2026-04-01T22:00:00.000Z",
      teams: threeTeams,
      matches: [
        {
          id: "m1",
          sequence: 1,
          teamAId: "t1",
          teamBId: "t2",
          teamAName: "A",
          teamBName: "B",
          penaltyWinnerTeamId: null,
          events: [{ type: "GOAL", teamId: "t1", memberId: "p1", assistMemberId: null, voidedAt: null }],
        },
        {
          id: "m2",
          sequence: 2,
          teamAId: "t2",
          teamBId: "t3",
          teamAName: "B",
          teamBName: "C",
          penaltyWinnerTeamId: null,
          events: [{ type: "GOAL", teamId: "t2", memberId: "p2", assistMemberId: null, voidedAt: null }],
        },
        {
          id: "m3",
          sequence: 3,
          teamAId: "t3",
          teamBId: "t1",
          teamAName: "C",
          teamBName: "A",
          penaltyWinnerTeamId: null,
          events: [{ type: "GOAL", teamId: "t3", memberId: "p3", assistMemberId: null, voidedAt: null }],
        },
      ],
    }),
    tz,
    null,
  );
  check("empate total → champion tied", tied.champion.kind === "tied");

  const empty = summarizeHistoricoSession(
    session({ id: "empty", startsAt: "2026-05-01T22:00:00.000Z", matches: [] }),
    tz,
    null,
  );
  check("sem partidas → undetermined", empty.champion.kind === "undetermined" && empty.matchCount === 0);
}

{
  const tz = "America/Sao_Paulo";
  const a = summarizeHistoricoSession(
    session({
      id: "a",
      startsAt: "2026-02-10T22:00:00.000Z",
      finishedAt: "2026-02-11T01:00:00.000Z",
    }),
    tz,
    "b",
  );
  const b = summarizeHistoricoSession(
    session({
      id: "b",
      startsAt: "2026-02-20T22:00:00.000Z",
      finishedAt: "2026-02-21T01:00:00.000Z",
    }),
    tz,
    "b",
  );
  const c = summarizeHistoricoSession(
    session({
      id: "c",
      startsAt: "2026-01-05T22:00:00.000Z",
      finishedAt: "2026-01-06T01:00:00.000Z",
    }),
    tz,
    "b",
  );
  const groups = groupHistoricoByMonth([a, b, c]);
  check("meses agrupados desc", groups[0]!.month === 2 && groups[1]!.month === 1);
  check(
    "dentro do mês: finishedAt desc",
    groups[0]!.sessions[0]!.sessionId === "b" && groups[0]!.sessions[1]!.sessionId === "a",
  );
  check("somente b é latest global no ano", b.isGlobalLatest && !a.isGlobalLatest && !c.isGlobalLatest);
  check("histórico vazio", groupHistoricoByMonth([]).length === 0);
}

{
  const withTiming = buildHistoricoDurationSeries([
    {
      id: "ok",
      sequence: 1,
      status: "FINISHED",
      startedAt: new Date("2026-01-01T21:00:00.000Z"),
      pausedAt: null,
      pausedTotalMs: 60_000,
      endedAt: new Date("2026-01-01T21:10:00.000Z"),
      plannedDurationSec: 600,
    },
    {
      id: "missing-end",
      sequence: 2,
      status: "FINISHED",
      startedAt: new Date("2026-01-01T21:20:00.000Z"),
      pausedAt: null,
      pausedTotalMs: 0,
      endedAt: null,
      plannedDurationSec: 600,
    },
  ]);
  check(
    "duração só com endedAt; pausas descontadas",
    withTiming.length === 1 && withTiming[0]!.matchId === "ok" && withTiming[0]!.elapsedMs === 9 * 60_000,
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
