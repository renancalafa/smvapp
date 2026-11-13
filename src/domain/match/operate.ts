/** Sessão ainda aceita operação de partida (não encerrada / cancelada). */
export function isSessionOpenForMatchOps(status: string): boolean {
  return status !== "FINISHED" && status !== "CANCELLED";
}

/**
 * Pode operar partidas desta sessão?
 * Admin do grupo OU scout ativo (revokedAt null) na sessão, com sessão ainda aberta.
 */
export function canOperateMatch(input: {
  memberRole: "ADMIN" | "PLAYER";
  sessionStatus: string;
  hasActiveScoutAssignment: boolean;
}): boolean {
  if (!isSessionOpenForMatchOps(input.sessionStatus)) return false;
  if (input.memberRole === "ADMIN") return true;
  return input.hasActiveScoutAssignment;
}
