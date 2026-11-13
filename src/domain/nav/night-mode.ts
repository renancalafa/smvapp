// Modo exclusivo Rodada ↔ Ao Vivo a partir de estado persistido + janela de jogo.

import { decideInProgressSpectatorFocus } from "@/domain/live/spectator-focus";

export type NightSessionStatus =
  | "SCHEDULED"
  | "OPEN"
  | "LOCKED"
  | "IN_PROGRESS"
  | "FINISHED"
  | "CANCELLED";

export type NightDrawStatus = "VOTING" | "DECIDED" | "TIED" | "INVALIDATED";

export type NightModeSession = {
  id: string;
  status: NightSessionStatus;
  startsAtMs: number;
  endsAtMs: number;
  maxExtraMinutes: number;
  finishedAtMs: number | null;
  /** Partida com cronômetro já ligado (não basta aguardar apito / sugestão). */
  hasActiveMatch: boolean;
};

export type NightModeDraw = {
  gameSessionId: string;
  /** Ausente ou null = sem sorteio ativo. */
  invalidatedAtMs: number | null;
  status: NightDrawStatus;
  winningOptionId: string | null;
};

export type NightNavMode =
  | { kind: "rodada"; finishedSessionId: string | null }
  | { kind: "ao_vivo"; liveSessionId: string };

export function isActiveDecidedDraw(draw: NightModeDraw | null | undefined): boolean {
  if (!draw) return false;
  if (draw.invalidatedAtMs != null) return false;
  return draw.status === "DECIDED" && draw.winningOptionId != null;
}

/**
 * Elegível para Ao Vivo: sorteio DECIDED ativo, sessão não encerrada/cancelada,
 * e ainda dentro da janela de jogo (ou com partida ativa além da janela).
 */
export function isLiveEligibleSession(
  session: NightModeSession,
  draw: NightModeDraw | null | undefined,
  nowMs: number,
): boolean {
  if (session.status === "FINISHED" || session.status === "CANCELLED") return false;
  if (!isActiveDecidedDraw(draw)) return false;
  return (
    decideInProgressSpectatorFocus({
      nowMs,
      endsAtMs: session.endsAtMs,
      maxExtraMinutes: session.maxExtraMinutes,
      hasActiveMatch: session.hasActiveMatch,
    }) === "live"
  );
}

/** Entre elegíveis, a de startsAt mais recente; empate por id estável. */
export function selectLiveNightSession(
  sessions: ReadonlyArray<NightModeSession>,
  drawsBySessionId: ReadonlyMap<string, NightModeDraw>,
  nowMs: number,
): NightModeSession | null {
  const eligible = sessions
    .filter((session) => isLiveEligibleSession(session, drawsBySessionId.get(session.id), nowMs))
    .sort((a, b) => b.startsAtMs - a.startsAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return eligible[0] ?? null;
}

/** Campos mínimos para escolher o recap da Rodada (sem janela de jogo). */
export type NightFinishedSession = Pick<NightModeSession, "id" | "status" | "finishedAtMs">;

/** Sessão oficialmente encerrada mais recente por finishedAt; empate por id. */
export function selectLatestFinishedSession(
  sessions: ReadonlyArray<NightFinishedSession>,
): NightFinishedSession | null {
  const finished = sessions
    .filter((session) => session.status === "FINISHED" && session.finishedAtMs != null)
    .sort(
      (a, b) =>
        (b.finishedAtMs ?? 0) - (a.finishedAtMs ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return finished[0] ?? null;
}

/**
 * Resolve o item exclusivo da navegação.
 * - Ao Vivo: Draw ativo DECIDED em sessão viva (não FINISHED/CANCELLED) ainda na janela
 *   de jogo, ou com partida com cronômetro ligado além da janela.
 * - Caso contrário: Rodada (último FINISHED ou vazio).
 */
export function resolveNightNavMode(
  sessions: ReadonlyArray<NightModeSession>,
  draws: ReadonlyArray<NightModeDraw>,
  nowMs: number,
): NightNavMode {
  const drawsBySessionId = new Map<string, NightModeDraw>();
  for (const draw of draws) {
    // Preferir o registro ativo (invalidatedAt null); invalidado só se não houver ativo.
    const previous = drawsBySessionId.get(draw.gameSessionId);
    if (!previous || (previous.invalidatedAtMs != null && draw.invalidatedAtMs == null)) {
      drawsBySessionId.set(draw.gameSessionId, draw);
    }
  }

  const live = selectLiveNightSession(sessions, drawsBySessionId, nowMs);
  if (live) return { kind: "ao_vivo", liveSessionId: live.id };

  const finished = selectLatestFinishedSession(sessions);
  return { kind: "rodada", finishedSessionId: finished?.id ?? null };
}

export function nightNavItem(mode: NightNavMode): { href: "/rodada" | "/live"; label: "Rodada" | "Ao Vivo" } {
  if (mode.kind === "ao_vivo") return { href: "/live", label: "Ao Vivo" };
  return { href: "/rodada", label: "Rodada" };
}
