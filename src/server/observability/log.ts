import "server-only";

export type StructuredLogSeverity = "debug" | "info" | "warn" | "error";

export type StructuredOpLog = {
  severity?: StructuredLogSeverity;
  operation: string;
  correlationId?: string | null;
  actorUserId?: string | null;
  gameSessionId?: string | null;
  matchId?: string | null;
  durationMs?: number | null;
  outcome: "success" | "failure" | "denied" | "conflict";
  errorClass?: string | null;
  message?: string | null;
};

/**
 * Log técnico estruturado (stdout). Não grava no AuditLog.
 * Evitar em polls de espectador / leituras rotineiras.
 */
export function logOperation(entry: StructuredOpLog): void {
  const line = {
    ts: new Date().toISOString(),
    severity: entry.severity ?? (entry.outcome === "success" ? "info" : "warn"),
    operation: entry.operation,
    correlationId: entry.correlationId ?? null,
    actorUserId: entry.actorUserId ?? null,
    gameSessionId: entry.gameSessionId ?? null,
    matchId: entry.matchId ?? null,
    durationMs: entry.durationMs ?? null,
    outcome: entry.outcome,
    errorClass: entry.errorClass ?? null,
    message: entry.message ?? null,
  };
  const payload = JSON.stringify(line);
  if (entry.outcome === "success") console.info(payload);
  else if (entry.outcome === "denied") console.warn(payload);
  else console.error(payload);
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
