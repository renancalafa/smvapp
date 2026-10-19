import "server-only";
import { isAwaitingKickoff } from "@/domain/match/kickoff";
import type { SpectatorPollPhase } from "@/domain/live/polling";
import { db } from "@/server/db";
import { getLiveBoard, type LiveBoard } from "./queries";

const RECENT_ENDED_MS = 12 * 60 * 60 * 1000;

export type SpectatorSessionSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  finishedAt: string | null;
  status: "SCHEDULED" | "OPEN" | "LOCKED" | "IN_PROGRESS" | "FINISHED" | "CANCELLED";
};

export type SpectatorLiveState =
  | { kind: "idle" }
  | {
      kind: "live" | "ended";
      session: SpectatorSessionSummary;
      board: LiveBoard;
    };

/** Snapshot serializável para SSR + /api/live. */
export type SpectatorLiveSnapshot = {
  revision: string;
  pollPhase: SpectatorPollPhase;
  state: SpectatorLiveState;
  serverNow: string;
};

type SessionCandidate = {
  id: string;
  status: SpectatorSessionSummary["status"];
  startsAt: Date;
  endsAt: Date;
  maxExtraMinutes: number;
  venueName: string | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

type Focus =
  | { kind: "idle" }
  | { kind: "live" | "ended"; session: SessionCandidate };

const SESSION_SELECT = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  maxExtraMinutes: true,
  venueName: true,
  finishedAt: true,
  updatedAt: true,
} as const;

function toSummary(session: SessionCandidate): SpectatorSessionSummary {
  return {
    id: session.id,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    venueName: session.venueName,
    finishedAt: session.finishedAt?.toISOString() ?? null,
    status: session.status,
  };
}

function playWindowEnd(session: SessionCandidate): Date {
  return new Date(session.endsAt.getTime() + session.maxExtraMinutes * 60_000);
}

/** Sessão em foco (sem carregar o placar completo). */
export async function findSpectatorFocus(groupId: string, now = new Date()): Promise<Focus> {
  const inProgress = await db.gameSession.findFirst({
    where: { groupId, status: "IN_PROGRESS" },
    orderBy: { startsAt: "desc" },
    select: SESSION_SELECT,
  });
  if (inProgress) return { kind: "live", session: inProgress };

  const windowCandidates = await db.gameSession.findMany({
    where: {
      groupId,
      status: { notIn: ["CANCELLED", "FINISHED"] },
      startsAt: { lte: now },
    },
    orderBy: { startsAt: "desc" },
    take: 5,
    select: SESSION_SELECT,
  });
  const inWindow = windowCandidates.find((session) => now.getTime() <= playWindowEnd(session).getTime());
  if (inWindow) return { kind: "live", session: inWindow };

  const recentlyEnded = await db.gameSession.findFirst({
    where: {
      groupId,
      status: "FINISHED",
      finishedAt: { gte: new Date(now.getTime() - RECENT_ENDED_MS) },
    },
    orderBy: { finishedAt: "desc" },
    select: SESSION_SELECT,
  });
  if (recentlyEnded) return { kind: "ended", session: recentlyEnded };

  return { kind: "idle" };
}

/**
 * Token de revisão a partir de campos já persistidos (Match.version, times,
 * pausedAt, histórico, status da sessão). O relógio correndo NÃO altera o token:
 * remainingMs é recalculado no cliente a partir de serverNow + remainingMs.
 */
export async function buildSpectatorRevision(
  focus: Focus,
): Promise<{ revision: string; pollPhase: SpectatorPollPhase }> {
  if (focus.kind === "idle") {
    return { revision: "idle", pollPhase: "idle" };
  }

  const session = focus.session;
  if (focus.kind === "ended") {
    return {
      revision: [
        "ended",
        session.id,
        session.status,
        session.finishedAt?.getTime() ?? 0,
        session.updatedAt.getTime(),
      ].join(":"),
      pollPhase: "ended",
    };
  }

  const [matches, teams] = await Promise.all([
    db.match.findMany({
      where: { gameSessionId: session.id, status: { not: "CANCELLED" } },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        status: true,
        version: true,
        teamAId: true,
        teamBId: true,
        penaltyWinnerTeamId: true,
        startedAt: true,
        pausedAt: true,
        pausedTotalMs: true,
        endedAt: true,
        updatedAt: true,
      },
    }),
    db.sessionTeam.findMany({
      where: { gameSessionId: session.id },
      orderBy: [{ initialQueuePosition: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, initialQueuePosition: true, name: true },
    }),
  ]);

  const current = matches.find((match) => match.status === "IN_PROGRESS") ?? null;
  const finished = matches.filter((match) => match.status === "FINISHED");

  const finishedDigest = finished
    .map(
      (match) =>
        `${match.sequence}:${match.id}:v${match.version}:p${match.penaltyWinnerTeamId ?? ""}:e${match.endedAt?.getTime() ?? 0}:u${match.updatedAt.getTime()}`,
    )
    .join(",");

  const currentDigest = current
    ? [
        current.sequence,
        current.id,
        `v${current.version}`,
        current.teamAId,
        current.teamBId,
        `p${current.pausedAt?.getTime() ?? 0}`,
        `pt${current.pausedTotalMs}`,
        `s${current.startedAt.getTime()}`,
        `u${current.updatedAt.getTime()}`,
        isAwaitingKickoff(current) ? "await" : "run",
      ].join(":")
    : "none";

  // Fila / identidade dos times (Rei da Mesa + nomes no placar).
  const teamsDigest = teams
    .map((team) => `${team.id}:${team.kind}:q${team.initialQueuePosition ?? ""}:${team.name}`)
    .join(",");

  const revision = [
    "live",
    session.id,
    session.status,
    session.finishedAt?.getTime() ?? 0,
    session.updatedAt.getTime(),
    `n${matches.length}`,
    `teams[${teamsDigest}]`,
    `fin[${finishedDigest}]`,
    `cur[${currentDigest}]`,
  ].join("|");

  let pollPhase: SpectatorPollPhase = "waiting";
  if (current && !isAwaitingKickoff(current)) {
    pollPhase = "active";
  }

  return { revision, pollPhase };
}

export async function getSpectatorRevision(
  groupId: string,
  now = new Date(),
): Promise<{ revision: string; pollPhase: SpectatorPollPhase; focus: Focus }> {
  const focus = await findSpectatorFocus(groupId, now);
  const { revision, pollPhase } = await buildSpectatorRevision(focus);
  return { revision, pollPhase, focus };
}

/**
 * Sessão em foco para /live: partida em andamento, janela de jogo, ou
 * recentemente encerrada (preserva placar/histórico).
 */
export async function getSpectatorLiveState(
  groupId: string,
  now = new Date(),
): Promise<SpectatorLiveState> {
  const focus = await findSpectatorFocus(groupId, now);
  if (focus.kind === "idle") return { kind: "idle" };

  const board = await getLiveBoard(groupId, focus.session.id, now);
  if (!board) return { kind: "idle" };
  return { kind: focus.kind, session: toSummary(focus.session), board };
}

export async function getSpectatorLiveSnapshot(
  groupId: string,
  now = new Date(),
  /** Reuso do focus de getSpectatorRevision (evita 2ª query no caminho 200 pós-If-None-Match). */
  focusHint?: Focus,
): Promise<SpectatorLiveSnapshot> {
  const focus = focusHint ?? (await findSpectatorFocus(groupId, now));
  const { revision, pollPhase } = await buildSpectatorRevision(focus);

  if (focus.kind === "idle") {
    return {
      revision,
      pollPhase,
      state: { kind: "idle" },
      serverNow: now.toISOString(),
    };
  }

  const board = await getLiveBoard(groupId, focus.session.id, now);
  if (!board) {
    return {
      revision: "idle",
      pollPhase: "idle",
      state: { kind: "idle" },
      serverNow: now.toISOString(),
    };
  }

  return {
    revision,
    pollPhase,
    state: { kind: focus.kind, session: toSummary(focus.session), board },
    serverNow: now.toISOString(),
  };
}
