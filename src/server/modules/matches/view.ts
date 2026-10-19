import "server-only";
import { isAwaitingKickoff } from "@/domain/match/kickoff";
import { scoreFromEvents } from "@/domain/match/queue";
import { matchElapsedMs, matchRemainingMs } from "@/domain/match/timer";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export type MatchView = {
  id: string;
  gameSessionId: string;
  sequence: number;
  status: "IN_PROGRESS" | "FINISHED" | "CANCELLED";
  /** Times confirmados; cronômetro ainda não ligado. */
  awaitingKickoff: boolean;
  version: number;
  startedAt: string;
  pausedAt: string | null;
  pausedTotalMs: number;
  endedAt: string | null;
  plannedDurationSec: number;
  penaltyWinnerTeamId: string | null;
  teamA: { id: string; name: string; color: string | null };
  teamB: { id: string; name: string; color: string | null };
  scoreA: number;
  scoreB: number;
  elapsedMs: number;
  remainingMs: number;
  serverNow: string;
  players: {
    memberId: string;
    teamId: string;
    role: "FIELD" | "GOALKEEPER";
    name: string;
    nickname: string | null;
  }[];
  events: {
    id: string;
    type:
      | "GOAL"
      | "OWN_GOAL"
      | "BIG_MISS"
      | "YELLOW_CARD"
      | "BLUE_CARD"
      | "RED_CARD"
      | "HIT_WOODWORK"
      | "TACKLE";
    memberId: string;
    teamId: string;
    assistMemberId: string | null;
    elapsedSec: number;
    voidedAt: string | null;
    memberName: string;
    assistName: string | null;
  }[];
};

export async function buildMatchView(tx: Tx, matchId: string, now = new Date()): Promise<MatchView> {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      id: true,
      gameSessionId: true,
      sequence: true,
      status: true,
      version: true,
      startedAt: true,
      pausedAt: true,
      pausedTotalMs: true,
      endedAt: true,
      plannedDurationSec: true,
      penaltyWinnerTeamId: true,
      teamAId: true,
      teamBId: true,
      teamA: { select: { id: true, name: true, color: true } },
      teamB: { select: { id: true, name: true, color: true } },
      players: {
        select: {
          memberId: true,
          teamId: true,
          role: true,
          member: { select: { nickname: true, user: { select: { name: true } } } },
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
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
    },
  });

  const display = (person: { nickname: string | null; user: { name: string } }) =>
    person.nickname ? `${person.user.name} (${person.nickname})` : person.user.name;

  const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
  const timer = {
    status: match.status,
    startedAt: match.startedAt,
    pausedAt: match.pausedAt,
    pausedTotalMs: match.pausedTotalMs,
    endedAt: match.endedAt,
    plannedDurationSec: match.plannedDurationSec,
  };

  return {
    id: match.id,
    gameSessionId: match.gameSessionId,
    sequence: match.sequence,
    status: match.status,
    awaitingKickoff: isAwaitingKickoff(match),
    version: match.version,
    startedAt: match.startedAt.toISOString(),
    pausedAt: match.pausedAt?.toISOString() ?? null,
    pausedTotalMs: match.pausedTotalMs,
    endedAt: match.endedAt?.toISOString() ?? null,
    plannedDurationSec: match.plannedDurationSec,
    penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    teamA: match.teamA,
    teamB: match.teamB,
    scoreA,
    scoreB,
    elapsedMs: matchElapsedMs(timer, now),
    remainingMs: matchRemainingMs(timer, now),
    serverNow: now.toISOString(),
    players: match.players.map((player) => ({
      memberId: player.memberId,
      teamId: player.teamId,
      role: player.role,
      name: player.member.user.name,
      nickname: player.member.nickname,
    })),
    events: match.events.map((event) => ({
      id: event.id,
      type: event.type,
      memberId: event.memberId,
      teamId: event.teamId,
      assistMemberId: event.assistMemberId,
      elapsedSec: event.elapsedSec,
      voidedAt: event.voidedAt?.toISOString() ?? null,
      memberName: display(event.member),
      assistName: event.assist ? display(event.assist) : null,
    })),
  };
}
