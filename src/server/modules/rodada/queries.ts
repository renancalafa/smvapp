import "server-only";
import { scoreFromEvents } from "@/domain/match/queue";
import {
  aggregateSessionPlayerStats,
  buildHeadToHeadMatrix,
  buildTeamStandings,
  resolveRodadaChampion,
  type RodadaChampion,
  type RodadaHeadToHeadCell,
  type RodadaPlayerStatRow,
  type RodadaTeamStanding,
} from "@/domain/rodada/recap";
import { db } from "@/server/db";

export type RodadaRecap = {
  sessionId: string;
  scheduledFor: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  finishedAt: string | null;
  origin: "AUTOMATIC" | "EXTRAORDINARY";
  playerCount: number;
  teams: {
    id: string;
    name: string;
    color: string | null;
    kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
    players: { memberId: string; name: string; nickname: string | null }[];
  }[];
  matches: {
    id: string;
    sequence: number;
    teamAId: string;
    teamBId: string;
    teamAName: string;
    teamBName: string;
    scoreA: number;
    scoreB: number;
    penaltyWinnerTeamId: string | null;
  }[];
  standings: RodadaTeamStanding[];
  headToHead: { teamIds: string[]; cells: RodadaHeadToHeadCell[] };
  champion: RodadaChampion;
  playerStats: RodadaPlayerStatRow[];
  incompleteNote: string | null;
};

export async function getRodadaRecap(
  groupId: string,
  sessionId: string,
): Promise<RodadaRecap | null> {
  const session = await db.gameSession.findFirst({
    where: { id: sessionId, groupId, status: "FINISHED" },
    select: {
      id: true,
      scheduledFor: true,
      startsAt: true,
      endsAt: true,
      venueName: true,
      finishedAt: true,
      origin: true,
      teams: {
        orderBy: { initialQueuePosition: "asc" },
        select: {
          id: true,
          name: true,
          color: true,
          kind: true,
          initialQueuePosition: true,
          players: {
            select: {
              memberId: true,
              member: { select: { nickname: true, user: { select: { name: true } } } },
            },
          },
        },
      },
      registrations: {
        where: { status: "PARTICIPANT" },
        select: { memberId: true },
      },
    },
  });
  if (!session) return null;

  const matches = await db.match.findMany({
    where: { gameSessionId: sessionId, status: "FINISHED" },
    orderBy: { sequence: "asc" },
    select: {
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
      players: {
        select: { memberId: true, teamId: true, role: true },
      },
    },
  });

  const finishedInputs = matches.map((match) => {
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
    };
  });

  const teamInputs = session.teams.map((team) => ({
    id: team.id,
    name: team.name,
    color: team.color,
    kind: team.kind,
    initialQueuePosition: team.initialQueuePosition,
  }));

  const standings = buildTeamStandings(teamInputs, finishedInputs);
  const headToHead = buildHeadToHeadMatrix(teamInputs, finishedInputs);

  const regularTeams = session.teams
    .filter(
      (team): team is (typeof team) & { initialQueuePosition: number } =>
        team.kind === "REGULAR" && team.initialQueuePosition !== null,
    )
    .map((team) => ({
      id: team.id,
      name: team.name,
      initialQueuePosition: team.initialQueuePosition,
    }));

  const champion = resolveRodadaChampion({
    regularTeams,
    finished: finishedInputs,
  });

  const memberMap = new Map<string, { memberId: string; name: string; nickname: string | null }>();
  for (const team of session.teams) {
    for (const player of team.players) {
      memberMap.set(player.memberId, {
        memberId: player.memberId,
        name: player.member.user.name,
        nickname: player.member.nickname,
      });
    }
  }

  const events = matches.flatMap((match) =>
    match.events.map((event) => ({
      type: event.type,
      memberId: event.memberId,
      assistMemberId: event.assistMemberId,
      voidedAt: event.voidedAt,
    })),
  );
  const appearances = matches.flatMap((match) =>
    match.players.map((player) => ({
      memberId: player.memberId,
      matchId: match.id,
      teamId: player.teamId,
      role: player.role,
    })),
  );

  const playerStats = aggregateSessionPlayerStats({
    members: [...memberMap.values()],
    events,
    appearances,
    matchResults: finishedInputs.map((match) => ({
      matchId: match.id,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    })),
  });

  let incompleteNote: string | null = null;
  if (finishedInputs.length === 0) {
    incompleteNote = "Esta sessão foi encerrada sem partidas finalizadas registradas.";
  } else if (regularTeams.length !== 3 && regularTeams.length !== 4) {
    incompleteNote = "Formação fora do Rei da Mesa (3 ou 4 times): alguns agregados podem ficar limitados.";
  }

  return {
    sessionId: session.id,
    scheduledFor: session.scheduledFor.toISOString(),
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    venueName: session.venueName,
    finishedAt: session.finishedAt?.toISOString() ?? null,
    origin: session.origin,
    playerCount: session.registrations.length,
    teams: session.teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      kind: team.kind,
      players: team.players.map((player) => ({
        memberId: player.memberId,
        name: player.member.user.name,
        nickname: player.member.nickname,
      })),
    })),
    matches: finishedInputs,
    standings,
    headToHead,
    champion,
    playerStats,
    incompleteNote,
  };
}
