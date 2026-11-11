// Modo exclusivo Rodada ↔ Ao Vivo a partir de estado persistido (sem relógio).

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
  finishedAtMs: number | null;
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

export function isLiveEligibleSession(
  session: NightModeSession,
  draw: NightModeDraw | null | undefined,
): boolean {
  if (session.status === "FINISHED" || session.status === "CANCELLED") return false;
  return isActiveDecidedDraw(draw);
}

/** Entre elegíveis, a de startsAt mais recente; empate por id estável. */
export function selectLiveNightSession(
  sessions: ReadonlyArray<NightModeSession>,
  drawsBySessionId: ReadonlyMap<string, NightModeDraw>,
): NightModeSession | null {
  const eligible = sessions
    .filter((session) => isLiveEligibleSession(session, drawsBySessionId.get(session.id)))
    .sort((a, b) => b.startsAtMs - a.startsAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return eligible[0] ?? null;
}

/** Sessão oficialmente encerrada mais recente por finishedAt; empate por id. */
export function selectLatestFinishedSession(
  sessions: ReadonlyArray<NightModeSession>,
): NightModeSession | null {
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
 * - Ao Vivo: Draw ativo DECIDED com winningOptionId em sessão não FINISHED/CANCELLED.
 * - Caso contrário: Rodada (último FINISHED ou vazio).
 */
export function resolveNightNavMode(
  sessions: ReadonlyArray<NightModeSession>,
  draws: ReadonlyArray<NightModeDraw>,
): NightNavMode {
  const drawsBySessionId = new Map<string, NightModeDraw>();
  for (const draw of draws) {
    // Preferir o registro ativo (invalidatedAt null); invalidado só se não houver ativo.
    const previous = drawsBySessionId.get(draw.gameSessionId);
    if (!previous || (previous.invalidatedAtMs != null && draw.invalidatedAtMs == null)) {
      drawsBySessionId.set(draw.gameSessionId, draw);
    }
  }

  const live = selectLiveNightSession(sessions, drawsBySessionId);
  if (live) return { kind: "ao_vivo", liveSessionId: live.id };

  const finished = selectLatestFinishedSession(sessions);
  return { kind: "rodada", finishedSessionId: finished?.id ?? null };
}

export function nightNavItem(mode: NightNavMode): { href: "/rodada" | "/live"; label: "Rodada" | "Ao Vivo" } {
  if (mode.kind === "ao_vivo") return { href: "/live", label: "Ao Vivo" };
  return { href: "/rodada", label: "Rodada" };
}
