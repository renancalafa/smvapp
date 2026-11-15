import "server-only";
import { scoreFromEvents } from "@/domain/match/queue";
import { db } from "@/server/db";
import type { HistoricoMatchDetail } from "@/server/modules/historico/queries";

export type MatchCorrectionDetail = {
  sessionId: string;
  sessionStatus: string;
  match: HistoricoMatchDetail;
  teamNames: { id: string; name: string }[];
};

/** Detalhe de partida FINISHED para correção ADMIN (sessão aberta, expirada ou FINISHED). */
export async function getFinishedMatchCorrectionDetail(
  groupId: string,
  sessionId: string,
  matchId: string,
): Promise<MatchCorrectionDetail | null> {
  const session = await db.gameSession.findFirst({
    where: { id: sessionId, groupId },
    select: {
      id: true,
      status: true,
      teams: { select: { id: true, name: true } },
    },
  });
  if (!session || session.status === "CANCELLED") return null;

  const match = await db.match.findFirst({
    where: { id: matchId, gameSessionId: sessionId, status: "FINISHED" },
    select: {
      id: true,
      sequence: true,
      version: true,
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      startedAt: true,
      endedAt: true,
      pausedAt: true,
      pausedTotalMs: true,
      plannedDurationSec: true,
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
          enteredAt: true,
          leftAt: true,
          member: { select: { nickname: true, user: { select: { name: true } } } },
        },
      },
    },
  });
  if (!match) return null;

  function memberLabel(member: { nickname: string | null; user: { name: string } }): string {
    return member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name;
  }

  const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
  const elapsedMs =
    match.endedAt != null
      ? Math.max(
          0,
          match.endedAt.getTime() - match.startedAt.getTime() - match.pausedTotalMs,
        )
      : null;

  return {
    sessionId: session.id,
    sessionStatus: session.status,
    teamNames: session.teams,
    match: {
      id: match.id,
      sequence: match.sequence,
      version: match.version,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      teamAName: match.teamA.name,
      teamBName: match.teamB.name,
      scoreA,
      scoreB,
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
        enteredAt: player.enteredAt.toISOString(),
        leftAt: player.leftAt?.toISOString() ?? null,
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
    },
  };
}
