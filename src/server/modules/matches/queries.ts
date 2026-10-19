import "server-only";
import { matchClockHasStarted } from "@/domain/match/kickoff";
import {
  scoreFromEvents,
  softFirstMatchHint,
  suggestMatchupAfterHistory,
  type QueueTeam,
} from "@/domain/match/queue";
import { db } from "@/server/db";
import { buildMatchView, type MatchView } from "./view";

export type { MatchView };

export type TeamSummary = {
  id: string;
  name: string;
  color: string | null;
  initialQueuePosition: number | null;
  kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
};

export type TeamRosterPlayer = {
  memberId: string;
  teamId: string;
  name: string;
  nickname: string | null;
  role: "FIELD" | "GOALKEEPER";
};

export type LiveBoard = {
  sessionId: string;
  matchDurationSec: number;
  teamCount: 3 | 4 | null;
  teams: TeamSummary[];
  /** Escalação atual por SessionTeam (para placar pré-apito sem Match). */
  rostersByTeamId: Record<string, TeamRosterPlayer[]>;
  current: MatchView | null;
  /** Sugestão Rei da Mesa (null na 1ª partida; o ADMIN escolhe livremente). */
  suggested: { teamAId: string; teamBId: string; waitingTeamIds: string[] } | null;
  /** Hint fraco 1×2 só quando ainda não há partidas (não obrigatório). */
  softHint: { teamAId: string; teamBId: string } | null;
  nextSequence: number;
  history: {
    id: string;
    sequence: number;
    teamAName: string;
    teamBName: string;
    scoreA: number;
    scoreB: number;
    penaltyWinnerTeamId: string | null;
    endedAt: string | null;
  }[];
  participantsFrozen: boolean;
};

async function loadRegularQueue(sessionId: string): Promise<QueueTeam[]> {
  const teams = await db.sessionTeam.findMany({
    where: { gameSessionId: sessionId, kind: "REGULAR" },
    select: { id: true, initialQueuePosition: true },
  });
  return teams
    .filter((team): team is { id: string; initialQueuePosition: number } => team.initialQueuePosition !== null)
    .map((team) => ({ id: team.id, initialQueuePosition: team.initialQueuePosition }));
}

export async function getLiveBoard(groupId: string, sessionId: string, now = new Date()): Promise<LiveBoard | null> {
  const session = await db.gameSession.findFirst({
    where: { id: sessionId, groupId },
    select: {
      id: true,
      matchDurationSec: true,
      teams: {
        orderBy: { initialQueuePosition: "asc" },
        select: { id: true, name: true, color: true, initialQueuePosition: true, kind: true },
      },
      matches: {
        select: { status: true, startedAt: true, pausedAt: true, pausedTotalMs: true },
      },
    },
  });
  if (!session) return null;

  const matches = await db.match.findMany({
    where: { gameSessionId: sessionId, status: { not: "CANCELLED" } },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      status: true,
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      endedAt: true,
      startedAt: true,
      pausedAt: true,
      pausedTotalMs: true,
      teamA: { select: { name: true } },
      teamB: { select: { name: true } },
      events: { select: { type: true, teamId: true, voidedAt: true } },
    },
  });

  const currentRow = matches.find((match) => match.status === "IN_PROGRESS") ?? null;
  const current = currentRow ? await buildMatchView(db, currentRow.id, now) : null;

  const finished = matches
    .filter((match) => match.status === "FINISHED")
    .map((match) => {
      const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
      return {
        id: match.id,
        sequence: match.sequence,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        teamAName: match.teamA.name,
        teamBName: match.teamB.name,
        scoreA,
        scoreB,
        penaltyWinnerTeamId: match.penaltyWinnerTeamId,
        endedAt: match.endedAt?.toISOString() ?? null,
      };
    });

  const regular = await loadRegularQueue(sessionId);
  const teamCount = regular.length === 3 || regular.length === 4 ? regular.length : null;
  let suggested: LiveBoard["suggested"] = null;
  let softHint: LiveBoard["softHint"] = null;
  if (teamCount && !currentRow) {
    try {
      const matchup = suggestMatchupAfterHistory({
        regularTeams: regular,
        finished: finished.map((match) => ({
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          penaltyWinnerTeamId: match.penaltyWinnerTeamId,
        })),
      });
      if (matchup) {
        suggested = {
          teamAId: matchup.teamAId,
          teamBId: matchup.teamBId,
          waitingTeamIds: matchup.waiting.map((team) => team.id),
        };
      } else {
        const hint = softFirstMatchHint(regular);
        if (hint) softHint = { teamAId: hint.teamAId, teamBId: hint.teamBId };
      }
    } catch {
      suggested = null;
    }
  }

  const rosterRows = await db.sessionTeamPlayer.findMany({
    where: { gameSessionId: sessionId },
    select: {
      memberId: true,
      sessionTeamId: true,
      member: {
        select: {
          nickname: true,
          user: { select: { name: true } },
          registrations: {
            where: { gameSessionId: sessionId, status: "PARTICIPANT" },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const rostersByTeamId: Record<string, TeamRosterPlayer[]> = {};
  for (const row of rosterRows) {
    if (row.member.registrations.length === 0) continue;
    const list = rostersByTeamId[row.sessionTeamId] ?? [];
    list.push({
      memberId: row.memberId,
      teamId: row.sessionTeamId,
      name: row.member.user.name,
      nickname: row.member.nickname,
      role: "FIELD",
    });
    rostersByTeamId[row.sessionTeamId] = list;
  }

  return {
    sessionId: session.id,
    matchDurationSec: session.matchDurationSec,
    teamCount,
    teams: session.teams,
    rostersByTeamId,
    current,
    suggested,
    softHint,
    nextSequence: finished.length + 1,
    history: finished.map((match) => ({
      id: match.id,
      sequence: match.sequence,
      teamAName: match.teamAName,
      teamBName: match.teamBName,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
      endedAt: match.endedAt,
    })),
    participantsFrozen: session.matches.some((match) => matchClockHasStarted(match)),
  };
}
