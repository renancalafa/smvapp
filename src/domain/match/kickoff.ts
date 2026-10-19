// Partida confirmada (times escolhidos) mas cronômetro ainda não iniciado.
// Sem coluna extra no schema: IN_PROGRESS com pausedAt === startedAt e pausedTotalMs === 0.

export type KickoffTimestamps = {
  status: "IN_PROGRESS" | "FINISHED" | "CANCELLED";
  startedAt: Date;
  pausedAt: Date | null;
  pausedTotalMs: number;
};

/** Times confirmados; o ADMIN ainda não deu o apito inicial. */
export function isAwaitingKickoff(match: KickoffTimestamps): boolean {
  return (
    match.status === "IN_PROGRESS" &&
    match.pausedAt !== null &&
    match.pausedTotalMs === 0 &&
    match.pausedAt.getTime() === match.startedAt.getTime()
  );
}

/** A partida chegou a ter o cronômetro ligado (congela a lista na primeira vez). */
export function matchClockHasStarted(match: KickoffTimestamps): boolean {
  if (match.status === "FINISHED") return true;
  if (match.status === "IN_PROGRESS") return !isAwaitingKickoff(match);
  // CANCELLED: só conta se o cronômetro já tinha sido ligado.
  return !(
    match.pausedAt !== null &&
    match.pausedTotalMs === 0 &&
    match.pausedAt.getTime() === match.startedAt.getTime()
  );
}
