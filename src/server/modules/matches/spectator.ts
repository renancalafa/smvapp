import "server-only";
import { isAwaitingKickoff } from "@/domain/match/kickoff";
import type { SpectatorPollPhase } from "@/domain/live/polling";
import { db } from "@/server/db";
import { getNightNavMode } from "@/server/modules/nav/night-mode";
import { getLiveBoard, type LiveBoard } from "./queries";

export type SpectatorSessionSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  finishedAt: string | null;
  origin: "AUTOMATIC" | "EXTRAORDINARY";
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
  origin: SpectatorSessionSummary["origin"];
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
  origin: true,
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
    origin: session.origin,
    status: session.status,
  };
}

/**
 * Foco público do Ao Vivo: só a sessão live-eligible do modo noturno
 * (Draw ativo DECIDED em sessão não FINISHED/CANCELLED). Recap pós-sessão → /rodada.
 */
export async function findSpectatorFocus(groupId: string, now = new Date()): Promise<Focus> {
  void now;
  const mode = await getNightNavMode(groupId);
  if (mode.kind !== "ao_vivo") return { kind: "idle" };

  const session = await db.gameSession.findFirst({
    where: { id: mode.liveSessionId, groupId, status: { notIn: ["FINISHED", "CANCELLED"] } },
    select: SESSION_SELECT,
  });
  if (!session) return { kind: "idle" };
  return { kind: "live", session };
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
 * Sessão em foco para /live: apenas noite com sorteio DECIDED ativo.
 * Recap de sessão encerrada fica em /rodada.
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
