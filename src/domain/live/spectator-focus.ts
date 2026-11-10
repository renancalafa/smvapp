/** Janela em que uma sessão encerrada ainda aparece no Ao Vivo (histórico). */
export const RECENT_ENDED_MS = 12 * 60 * 60 * 1000;

export type InProgressSpectatorDecision = "live" | "ended" | "stale";

/** Fim da janela de jogo permitida: endsAt + maxExtraMinutes. */
export function playWindowEndMs(endsAtMs: number, maxExtraMinutes: number): number {
  return endsAtMs + maxExtraMinutes * 60_000;
}

/**
 * Decisão de foco para uma sessão ainda IN_PROGRESS no banco.
 * Não altera status; só classifica se o Ao Vivo deve tratá-la como live, ended ou ignorá-la.
 */
export function decideInProgressSpectatorFocus(input: {
  nowMs: number;
  endsAtMs: number;
  maxExtraMinutes: number;
  hasActiveMatch: boolean;
}): InProgressSpectatorDecision {
  const windowEndMs = playWindowEndMs(input.endsAtMs, input.maxExtraMinutes);
  if (input.nowMs <= windowEndMs) return "live";
  // Partida real ainda em andamento além da janela: preservar visibilidade.
  if (input.hasActiveMatch) return "live";
  if (input.nowMs - windowEndMs <= RECENT_ENDED_MS) return "ended";
  return "stale";
}

export type SpectatorFocusSessionInput = {
  id: string;
  status: "SCHEDULED" | "OPEN" | "LOCKED" | "IN_PROGRESS" | "FINISHED" | "CANCELLED";
  startsAtMs: number;
  endsAtMs: number;
  maxExtraMinutes: number;
  finishedAtMs: number | null;
  hasActiveMatch: boolean;
};

export type SpectatorFocusSelection =
  | { kind: "idle" }
  | { kind: "live" | "ended"; sessionId: string };

/**
 * Algoritmo puro de seleção do Ao Vivo (espelha findSpectatorFocus).
 * Usado em regressão; a implementação com DB aplica as mesmas regras via queries.
 */
export function selectSpectatorFocus(
  sessions: ReadonlyArray<SpectatorFocusSessionInput>,
  nowMs: number,
): SpectatorFocusSelection {
  const inProgress = [...sessions]
    .filter((session) => session.status === "IN_PROGRESS")
    .sort((a, b) => b.startsAtMs - a.startsAtMs)[0];

  if (inProgress) {
    const decision = decideInProgressSpectatorFocus({
      nowMs,
      endsAtMs: inProgress.endsAtMs,
      maxExtraMinutes: inProgress.maxExtraMinutes,
      hasActiveMatch: inProgress.hasActiveMatch,
    });
    if (decision === "live") return { kind: "live", sessionId: inProgress.id };
    if (decision === "ended") return { kind: "ended", sessionId: inProgress.id };
  }

  const inWindow = [...sessions]
    .filter(
      (session) =>
        session.status !== "CANCELLED" &&
        session.status !== "FINISHED" &&
        session.startsAtMs <= nowMs &&
        nowMs <= playWindowEndMs(session.endsAtMs, session.maxExtraMinutes),
    )
    .sort((a, b) => b.startsAtMs - a.startsAtMs)[0];
  if (inWindow) return { kind: "live", sessionId: inWindow.id };

  const recentlyEnded = [...sessions]
    .filter(
      (session) =>
        session.status === "FINISHED" &&
        session.finishedAtMs != null &&
        nowMs - session.finishedAtMs <= RECENT_ENDED_MS,
    )
    .sort((a, b) => (b.finishedAtMs ?? 0) - (a.finishedAtMs ?? 0))[0];
  if (recentlyEnded) return { kind: "ended", sessionId: recentlyEnded.id };

  return { kind: "idle" };
}
