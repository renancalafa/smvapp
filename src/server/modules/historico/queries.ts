import "server-only";
import {
  buildHistoricoDurationSeries,
  collectHistoricoYears,
  groupHistoricoByMonth,
  summarizeHistoricoSession,
  type HistoricoDurationPoint,
  type HistoricoMonthGroup,
  type HistoricoSessionSummary,
} from "@/domain/historico/archive";
import { selectLatestFinishedSession } from "@/domain/nav/night-mode";
import { periodInstantRange } from "@/domain/stats/aggregate";
import { getRodadaRecap, type RodadaRecap } from "@/server/modules/rodada/queries";
import { db } from "@/server/db";

export type { HistoricoDurationPoint, HistoricoMonthGroup, HistoricoSessionSummary };

const leanMatchSelect = {
  id: true,
  sequence: true,
  teamAId: true,
  teamBId: true,
  penaltyWinnerTeamId: true,
  teamA: { select: { name: true } },
  teamB: { select: { name: true } },
  events: {
    select: {
      type: true,
      teamId: true,
      memberId: true,
      assistMemberId: true,
      voidedAt: true,
    },
  },
} as const;

const leanTeamSelect = {
  id: true,
  name: true,
  color: true,
  kind: true,
  initialQueuePosition: true,
} as const;

export async function listHistoricoYears(groupId: string, timeZone: string): Promise<number[]> {
  const sessions = await db.gameSession.findMany({
    where: { groupId, status: "FINISHED" },
    select: { startsAt: true },
  });
  return collectHistoricoYears(sessions, timeZone);
}

export async function getLatestFinishedSessionId(groupId: string): Promise<string | null> {
  const sessions = await db.gameSession.findMany({
    where: { groupId, status: "FINISHED" },
    select: { id: true, status: true, startsAt: true, finishedAt: true },
  });
  const latest = selectLatestFinishedSession(
    sessions.map((session) => ({
      id: session.id,
      status: session.status,
      startsAtMs: session.startsAt.getTime(),
      finishedAtMs: session.finishedAt?.getTime() ?? null,
    })),
  );
  return latest?.id ?? null;
}

export async function listHistoricoSessions(
  groupId: string,
  timeZone: string,
  year: number,
): Promise<{
  year: number;
  globalLatestSessionId: string | null;
  months: HistoricoMonthGroup[];
  sessions: HistoricoSessionSummary[];
}> {
  const { start, end } = periodInstantRange({ kind: "year", year }, timeZone);
  const [sessions, globalLatestSessionId] = await Promise.all([
    db.gameSession.findMany({
      where: {
        groupId,
        status: "FINISHED",
        startsAt: { gte: start, lt: end },
      },
      orderBy: [{ finishedAt: "desc" }, { startsAt: "desc" }],
      select: {
        id: true,
        startsAt: true,
        finishedAt: true,
        teams: { orderBy: { initialQueuePosition: "asc" }, select: leanTeamSelect },
        matches: {
          where: { status: "FINISHED" },
          orderBy: { sequence: "asc" },
          select: leanMatchSelect,
        },
      },
    }),
    getLatestFinishedSessionId(groupId),
  ]);

  const summaries = sessions.map((session) =>
    summarizeHistoricoSession(
      {
        id: session.id,
        startsAt: session.startsAt,
        finishedAt: session.finishedAt,
        teams: session.teams,
        matches: session.matches.map((match) => ({
          id: match.id,
          sequence: match.sequence,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          teamAName: match.teamA.name,
          teamBName: match.teamB.name,
          penaltyWinnerTeamId: match.penaltyWinnerTeamId,
          events: match.events,
        })),
      },
      timeZone,
      globalLatestSessionId,
    ),
  );

  return {
    year,
    globalLatestSessionId,
    months: groupHistoricoByMonth(summaries),
    sessions: summaries,
  };
}

export type HistoricoMatchDetail = {
  id: string;
  sequence: number;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
  plannedDurationSec: number;
  players: {
    memberId: string;
    name: string;
    nickname: string | null;
    teamId: string;
    role: "FIELD" | "GOALKEEPER";
  }[];
  events: {
    id: string;
    type: string;
    memberId: string;
    memberName: string;
    teamId: string;
    assistMemberId: string | null;
    assistName: string | null;
    elapsedSec: number;
    voidedAt: string | null;
  }[];
};

export type HistoricoSessionDetail = {
  recap: RodadaRecap;
  matches: HistoricoMatchDetail[];
  durations: HistoricoDurationPoint[];
};

export async function getHistoricoSessionDetail(
  groupId: string,
  sessionId: string,
): Promise<HistoricoSessionDetail | null> {
  const [recap, matches] = await Promise.all([
    getRodadaRecap(groupId, sessionId),
    db.match.findMany({
      where: { gameSessionId: sessionId, status: "FINISHED", gameSession: { groupId, status: "FINISHED" } },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        teamAId: true,
        teamBId: true,
        penaltyWinnerTeamId: true,
        startedAt: true,
        endedAt: true,
        pausedAt: true,
        pausedTotalMs: true,
        plannedDurationSec: true,
        status: true,
        teamA: { select: { name: true } },
        teamB: { select: { name: true } },
        events: {
          orderBy: { elapsedSec: "asc" },
          select: {
            id: true,
            type: true,
            memberId: true,
            teamId: true,
            assistMemberId: true,
            elapsedSec: true,
            voidedAt: true,
            member: { select: { nickname: true, user: { select: { name: true } } } },
            assist: { select: { nickname: true, user: { select: { name: true } } } },
          },
        },
        players: {
          select: {
            memberId: true,
            teamId: true,
            role: true,
            member: { select: { nickname: true, user: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  if (!recap) return null;

  const teamNameById = new Map(recap.teams.map((team) => [team.id, team.name]));
  const scoreById = new Map(recap.matches.map((match) => [match.id, match]));

  function memberLabel(member: { nickname: string | null; user: { name: string } }): string {
    return member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name;
  }

  const detailMatches: HistoricoMatchDetail[] = matches.map((match) => {
    const scored = scoreById.get(match.id);
    const elapsedMs =
      match.endedAt != null
        ? buildHistoricoDurationSeries([
            {
              id: match.id,
              sequence: match.sequence,
              status: "FINISHED",
              startedAt: match.startedAt,
              pausedAt: match.pausedAt,
              pausedTotalMs: match.pausedTotalMs,
              endedAt: match.endedAt,
              plannedDurationSec: match.plannedDurationSec,
            },
          ])[0]?.elapsedMs ?? null
        : null;

    return {
      id: match.id,
      sequence: match.sequence,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      teamAName: teamNameById.get(match.teamAId) ?? match.teamA.name,
      teamBName: teamNameById.get(match.teamBId) ?? match.teamB.name,
      scoreA: scored?.scoreA ?? 0,
      scoreB: scored?.scoreB ?? 0,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
      startedAt: match.startedAt.toISOString(),
      endedAt: match.endedAt?.toISOString() ?? null,
      elapsedMs,
      plannedDurationSec: match.plannedDurationSec,
      players: match.players.map((player) => ({
        memberId: player.memberId,
        name: player.member.user.name,
        nickname: player.member.nickname,
        teamId: player.teamId,
        role: player.role,
      })),
      events: match.events.map((event) => ({
        id: event.id,
        type: event.type,
        memberId: event.memberId,
        memberName: memberLabel(event.member),
        teamId: event.teamId,
        assistMemberId: event.assistMemberId,
        assistName: event.assist ? memberLabel(event.assist) : null,
        elapsedSec: event.elapsedSec,
        voidedAt: event.voidedAt?.toISOString() ?? null,
      })),
    };
  });

  const durations = buildHistoricoDurationSeries(
    matches.map((match) => ({
      id: match.id,
      sequence: match.sequence,
      status: match.status,
      startedAt: match.startedAt,
      pausedAt: match.pausedAt,
      pausedTotalMs: match.pausedTotalMs,
      endedAt: match.endedAt,
      plannedDurationSec: match.plannedDurationSec,
    })),
  );

  return { recap, matches: detailMatches, durations };
}
