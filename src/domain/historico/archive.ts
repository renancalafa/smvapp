import { scoreFromEvents } from "@/domain/match/queue";
import { matchElapsedMs, type TimerMatch } from "@/domain/match/timer";
import {
  resolveRodadaChampion,
  type RodadaChampion,
  type RodadaFinishedMatchInput,
} from "@/domain/rodada/recap";
import { periodInstantRange } from "@/domain/stats/aggregate";
import { countValidGoals } from "@/domain/stats/dashboard";
import { resolveTeamDisplay } from "@/domain/team/colors";
import { civilDateInZone, type CivilDate } from "@/domain/time/zoned";

export type HistoricoTeamInput = {
  id: string;
  name: string;
  color: string | null;
  kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
  initialQueuePosition: number | null;
};

export type HistoricoMatchEventInput = {
  type: string;
  teamId: string;
  memberId: string;
  assistMemberId: string | null;
  voidedAt: Date | string | null;
};

export type HistoricoMatchInput = {
  id: string;
  sequence: number;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  penaltyWinnerTeamId: string | null;
  events: readonly HistoricoMatchEventInput[];
};

export type HistoricoSessionInput = {
  id: string;
  startsAt: Date;
  finishedAt: Date | null;
  teams: readonly HistoricoTeamInput[];
  matches: readonly HistoricoMatchInput[];
};

export type HistoricoMatchTile = {
  id: string;
  sequence: number;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
};

export type HistoricoSessionSummary = {
  sessionId: string;
  startsAt: string;
  finishedAt: string | null;
  year: number;
  month: number;
  day: number;
  matchCount: number;
  totalGoals: number;
  champion: RodadaChampion;
  matches: HistoricoMatchTile[];
  teams: {
    id: string;
    name: string;
    color: string | null;
    kind: HistoricoTeamInput["kind"];
    initialQueuePosition: number | null;
  }[];
  isGlobalLatest: boolean;
};

export type HistoricoMonthGroup = {
  year: number;
  month: number;
  label: string;
  sessions: HistoricoSessionSummary[];
};

/** Anos civis distintos de sessões FINISHED no fuso do grupo, desc. */
export function collectHistoricoYears(
  sessions: readonly { startsAt: Date }[],
  timeZone: string,
): number[] {
  const years = new Set<number>();
  for (const session of sessions) {
    years.add(civilDateInZone(session.startsAt, timeZone).year);
  }
  return [...years].sort((a, b) => b - a);
}

export function sessionInCivilYear(startsAt: Date, year: number, timeZone: string): boolean {
  const { start, end } = periodInstantRange({ kind: "year", year }, timeZone);
  const ms = startsAt.getTime();
  return ms >= start.getTime() && ms < end.getTime();
}

function displayTeams(teams: readonly HistoricoTeamInput[]) {
  return teams.map((team) => {
    const display = resolveTeamDisplay({
      name: team.name,
      color: team.color,
      kind: team.kind,
      position: team.initialQueuePosition,
    });
    return {
      id: team.id,
      name: display.displayName,
      color: display.colorHex,
      kind: team.kind,
      initialQueuePosition: team.initialQueuePosition,
    };
  });
}

export function buildHistoricoMatchTiles(
  matches: readonly HistoricoMatchInput[],
  teams: readonly HistoricoTeamInput[],
): HistoricoMatchTile[] {
  const displayById = new Map(displayTeams(teams).map((team) => [team.id, team]));
  return [...matches]
    .sort((a, b) => a.sequence - b.sequence)
    .map((match) => {
      const { scoreA, scoreB } = scoreFromEvents(
        match.events.map((event) => ({
          type: event.type,
          teamId: event.teamId,
          voidedAt:
            event.voidedAt == null
              ? null
              : event.voidedAt instanceof Date
                ? event.voidedAt
                : new Date(event.voidedAt),
        })),
        match.teamAId,
        match.teamBId,
      );
      return {
        id: match.id,
        sequence: match.sequence,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        teamAName: displayById.get(match.teamAId)?.name ?? match.teamAName,
        teamBName: displayById.get(match.teamBId)?.name ?? match.teamBName,
        scoreA,
        scoreB,
        penaltyWinnerTeamId: match.penaltyWinnerTeamId,
      };
    });
}

export function summarizeHistoricoSession(
  session: HistoricoSessionInput,
  timeZone: string,
  globalLatestId: string | null,
): HistoricoSessionSummary {
  const civil = civilDateInZone(session.startsAt, timeZone);
  const teams = displayTeams(session.teams);
  const matches = buildHistoricoMatchTiles(session.matches, session.teams);
  const finishedInputs: RodadaFinishedMatchInput[] = matches.map((match) => ({
    id: match.id,
    sequence: match.sequence,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    teamAName: match.teamAName,
    teamBName: match.teamBName,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    penaltyWinnerTeamId: match.penaltyWinnerTeamId,
  }));
  const totalGoals = session.matches.reduce(
    (sum, match) => sum + countValidGoals(match.events),
    0,
  );
  const champion = resolveRodadaChampion({
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    finished: finishedInputs,
  });

  return {
    sessionId: session.id,
    startsAt: session.startsAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    year: civil.year,
    month: civil.month,
    day: civil.day,
    matchCount: matches.length,
    totalGoals,
    champion,
    matches,
    teams,
    isGlobalLatest: globalLatestId != null && session.id === globalLatestId,
  };
}

/** Agrupa por mês civil (desc), sessões por finishedAt/startsAt desc. */
export function groupHistoricoByMonth(
  summaries: readonly HistoricoSessionSummary[],
): HistoricoMonthGroup[] {
  const byMonth = new Map<string, HistoricoSessionSummary[]>();
  for (const summary of summaries) {
    const key = `${summary.year}-${summary.month}`;
    const list = byMonth.get(key) ?? [];
    list.push(summary);
    byMonth.set(key, list);
  }

  const groups: HistoricoMonthGroup[] = [];
  for (const [key, sessions] of byMonth) {
    const [yearStr, monthStr] = key.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    sessions.sort((a, b) => {
      const aMs = a.finishedAt ? Date.parse(a.finishedAt) : Date.parse(a.startsAt);
      const bMs = b.finishedAt ? Date.parse(b.finishedAt) : Date.parse(b.startsAt);
      return bMs - aMs || a.sessionId.localeCompare(b.sessionId);
    });
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(year, month - 1, 15)),
    );
    groups.push({ year, month, label, sessions });
  }

  groups.sort((a, b) => b.year - a.year || b.month - a.month);
  return groups;
}

export type HistoricoDurationPoint = {
  matchId: string;
  sequence: number;
  elapsedMs: number;
  plannedDurationSec: number | null;
};

/** Só inclui partidas FINISHED com startedAt + endedAt confiáveis. */
export function buildHistoricoDurationSeries(
  matches: readonly (TimerMatch & { id: string; sequence: number; status: "FINISHED" | "IN_PROGRESS" | "CANCELLED" })[],
): HistoricoDurationPoint[] {
  const points: HistoricoDurationPoint[] = [];
  for (const match of matches) {
    if (match.status !== "FINISHED") continue;
    if (!match.endedAt) continue;
    const elapsedMs = matchElapsedMs(match, match.endedAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) continue;
    points.push({
      matchId: match.id,
      sequence: match.sequence,
      elapsedMs,
      plannedDurationSec: match.plannedDurationSec,
    });
  }
  return points.sort((a, b) => a.sequence - b.sequence);
}

export function formatCivilDay(civil: Pick<CivilDate, "day" | "month" | "year">): string {
  return `${String(civil.day).padStart(2, "0")}/${String(civil.month).padStart(2, "0")}/${civil.year}`;
}
