// Cronômetro da partida a partir dos timestamps do servidor (PROJECT.md §21 / §24).
// O cliente só exibe; o tempo decorrido sobrevive a refresh e reconexão.
// Com times confirmados e apito ainda não dado, o cronômetro fica no tempo cheio.

import { isAwaitingKickoff } from "./kickoff";

export type TimerMatch = {
  status: "IN_PROGRESS" | "FINISHED" | "CANCELLED";
  startedAt: Date;
  pausedAt: Date | null;
  pausedTotalMs: number;
  endedAt: Date | null;
  plannedDurationSec: number;
};

/** Milissegundos de jogo decorridos (pausas descontadas). */
export function matchElapsedMs(match: TimerMatch, now: Date): number {
  if (isAwaitingKickoff(match)) return 0;
  const end =
    match.status === "IN_PROGRESS"
      ? match.pausedAt
        ? match.pausedAt.getTime()
        : now.getTime()
      : (match.endedAt ?? match.pausedAt ?? now).getTime();
  return Math.max(0, end - match.startedAt.getTime() - match.pausedTotalMs);
}

/** Milissegundos restantes até o fim planejado (nunca negativo). */
export function matchRemainingMs(match: TimerMatch, now: Date): number {
  return Math.max(0, match.plannedDurationSec * 1000 - matchElapsedMs(match, now));
}

export function isTimerExpired(match: TimerMatch, now: Date): boolean {
  return matchRemainingMs(match, now) <= 0;
}
