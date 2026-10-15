import "server-only";
import { db } from "@/server/db";

// Leituras do sorteio. Força (balanceScore, strengthTotal, strengthSnapshot) e nomes de
// votantes só saem daqui com `admin: true` (PROJECT.md, seção 30).

export type DrawPlayerView = { memberId: string; name: string; strength: number | null };
export type DrawTeamView = {
  id: string;
  position: number;
  name: string;
  kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
  strengthTotal: number | null;
  players: DrawPlayerView[];
};
export type DrawOptionView = {
  id: string;
  label: string;
  balanceScore: number | null;
  teams: DrawTeamView[];
  /** Votos de quem ainda é elegível. */
  votes: number;
  voterNames: string[] | null;
};
export type DrawView = {
  id: string;
  sequence: number;
  status: "VOTING" | "DECIDED" | "TIED" | "INVALIDATED";
  decisionMethod: "VOTE" | "SINGLE_OPTION" | "ADMIN_RESOLUTION" | null;
  winningOptionId: string | null;
  optionDistance: number | null;
  minOptionDifference: number;
  createdAt: Date;
  decidedAt: Date | null;
  invalidatedAt: Date | null;
  invalidationReason: string | null;
  options: DrawOptionView[];
  eligibleVoters: number;
  /** Votos que deixaram de contar (o votante não é mais elegível). */
  ignoredVotes: number;
  myVoteOptionId: string | null;
};

const memberName = (member: { nickname: string | null; user: { name: string } }) =>
  member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name;

async function loadDraws(where: { gameSessionId: string; invalidatedAt?: null | { not: null } }) {
  return db.draw.findMany({
    where,
    orderBy: { sequence: "desc" },
    select: {
      id: true,
      sequence: true,
      status: true,
      decisionMethod: true,
      winningOptionId: true,
      optionDistance: true,
      minOptionDifference: true,
      createdAt: true,
      decidedAt: true,
      invalidatedAt: true,
      invalidationReason: true,
      options: {
        orderBy: { label: "asc" },
        select: {
          id: true,
          label: true,
          balanceScore: true,
          teams: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              name: true,
              kind: true,
              strengthTotal: true,
              players: {
                select: {
                  memberId: true,
                  strengthSnapshot: true,
                  member: { select: { nickname: true, user: { select: { name: true } } } },
                },
              },
            },
          },
          votes: {
            select: { voterMemberId: true, voter: { select: { nickname: true, user: { select: { name: true } } } } },
          },
        },
      },
    },
  });
}

type DrawRow = Awaited<ReturnType<typeof loadDraws>>[number];

function toView(draw: DrawRow, eligible: Set<string>, admin: boolean, viewerMemberId: string): DrawView {
  // Sorteios encerrados mostram todos os votos registrados; na votação aberta só contam elegíveis.
  const counts = (memberId: string) => draw.status !== "VOTING" || eligible.has(memberId);
  let ignoredVotes = 0;
  let myVoteOptionId: string | null = null;
  const options = draw.options.map((option) => {
    const counted = option.votes.filter((vote) => counts(vote.voterMemberId));
    ignoredVotes += option.votes.length - counted.length;
    if (option.votes.some((vote) => vote.voterMemberId === viewerMemberId)) myVoteOptionId = option.id;
    return {
      id: option.id,
      label: option.label,
      balanceScore: admin ? option.balanceScore : null,
      votes: counted.length,
      voterNames: admin ? counted.map((vote) => memberName(vote.voter)).sort((a, b) => a.localeCompare(b, "pt-BR")) : null,
      teams: option.teams.map((team) => ({
        id: team.id,
        position: team.position,
        name: team.name,
        kind: team.kind,
        strengthTotal: admin ? team.strengthTotal : null,
        players: team.players
          .map((player) => ({
            memberId: player.memberId,
            name: memberName(player.member),
            strength: admin ? player.strengthSnapshot : null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      })),
    };
  });
  return {
    id: draw.id,
    sequence: draw.sequence,
    status: draw.status,
    decisionMethod: draw.decisionMethod,
    winningOptionId: draw.winningOptionId,
    optionDistance: admin ? draw.optionDistance : null,
    minOptionDifference: draw.minOptionDifference,
    createdAt: draw.createdAt,
    decidedAt: draw.decidedAt,
    invalidatedAt: draw.invalidatedAt,
    invalidationReason: draw.invalidationReason,
    options,
    eligibleVoters: eligible.size,
    ignoredVotes,
    myVoteOptionId,
  };
}

async function eligibleVoters(sessionId: string): Promise<Set<string>> {
  const rows = await db.sessionRegistration.findMany({
    where: {
      gameSessionId: sessionId,
      status: "PARTICIPANT",
      modalitySnapshot: "MONTHLY",
      OR: [{ attendance: null }, { attendance: { not: "ABSENT" } }],
    },
    select: { memberId: true },
  });
  return new Set(rows.map((row) => row.memberId));
}

/** Sorteio ativo da sessão (o groupId já foi validado por quem chama). */
export async function getActiveDraw(sessionId: string, viewerMemberId: string, admin: boolean): Promise<DrawView | null> {
  const [draws, eligible] = await Promise.all([
    loadDraws({ gameSessionId: sessionId, invalidatedAt: null }),
    eligibleVoters(sessionId),
  ]);
  return draws[0] ? toView(draws[0], eligible, admin, viewerMemberId) : null;
}

/** Só o estado do sorteio ativo, para o card do início. */
export async function getActiveDrawStatus(sessionId: string) {
  const draw = await db.draw.findFirst({
    where: { gameSessionId: sessionId, invalidatedAt: null },
    select: { status: true },
  });
  return draw?.status ?? null;
}

/** Sorteios invalidados, com opções e votos preservados (somente ADMIN). */
export async function getDrawHistory(sessionId: string, viewerMemberId: string): Promise<DrawView[]> {
  const [draws, eligible] = await Promise.all([
    loadDraws({ gameSessionId: sessionId, invalidatedAt: { not: null } }),
    eligibleVoters(sessionId),
  ]);
  return draws.map((draw) => toView(draw, eligible, true, viewerMemberId));
}

/** Dados para escolher a formação e os rotativos (somente ADMIN). */
export async function getFormation(sessionId: string) {
  const [session, participants, matches] = await Promise.all([
    db.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { teamSize: true, overflowMode: true, priorityClosedAt: true, drawOptionsCount: true, drawMinOptionDifference: true },
    }),
    db.sessionRegistration.findMany({
      where: { gameSessionId: sessionId, status: "PARTICIPANT" },
      orderBy: { member: { user: { name: "asc" } } },
      select: {
        id: true,
        isRotating: true,
        modalitySnapshot: true,
        member: { select: { nickname: true, user: { select: { name: true } } } },
      },
    }),
    db.match.count({ where: { gameSessionId: sessionId } }),
  ]);
  return {
    ...session,
    hasMatches: matches > 0,
    participants: participants.map((registration) => ({
      id: registration.id,
      isRotating: registration.isRotating,
      modality: registration.modalitySnapshot,
      name: memberName(registration.member),
    })),
  };
}
