/** Outcome persistido em AuditLog.outcome (null = legado → SUCCESS na UI). */
export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

/** Severidade persistida em AuditLog.severity (null = legado → INFO na UI). */
export type AuditSeverity = "INFO" | "WARN" | "ERROR";

/** Categorias de filtro no Admin → Logs. */
export type AuditCategory =
  | "MATCH"
  | "ATTENDANCE"
  | "DRAW"
  | "SCOUT"
  | "ADMIN"
  | "AUTH"
  | "SYSTEM"
  | "OTHER";

export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ["SUCCESS", "FAILURE", "DENIED"];
export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "MATCH",
  "ATTENDANCE",
  "DRAW",
  "SCOUT",
  "ADMIN",
  "AUTH",
  "SYSTEM",
  "OTHER",
];

const MATCH_ACTIONS = new Set([
  "MATCH_TEAMS_CONFIRMED",
  "MATCH_TEAMS_CHANGED",
  "MATCH_KICKOFF",
  "MATCH_STARTED",
  "MATCH_PAUSED",
  "MATCH_RESUMED",
  "MATCH_FINISHED",
  "MATCH_CANCELLED",
  "MATCH_EVENT_RECORDED",
  "MATCH_EVENT_VOIDED",
  "MATCH_PENALTY_SET",
  "MATCH_PLAYER_SUBSTITUTED",
  "SESSION_TEAM_PLAYER_SUBSTITUTED",
  "MATCH_COMMAND_CONFLICT",
]);

const ATTENDANCE_ACTIONS = new Set([
  "REGISTRATION_CONFIRMED",
  "REGISTRATION_ADMIN_CONFIRMED_ON_BEHALF",
  "REGISTRATION_DECLINED",
  "REGISTRATION_WITHDRAWN",
  "REGISTRATION_PROMOTED",
  "REGISTRATION_DEMOTED",
  "REGISTRATION_ADMIN_INCLUDED",
  "REGISTRATION_ADMIN_REMOVED",
  "REGISTRATION_ADMIN_PROMOTED",
  "ATTENDANCE_MARKED",
  "REGISTRATION_ROTATING_SET",
  "SESSION_OVERFLOW_MODE_SET",
]);

const DRAW_ACTIONS = new Set([
  "DRAW_GENERATED",
  "DRAW_VOTE_CAST",
  "DRAW_VOTING_CLOSED",
  "DRAW_DECIDED",
  "DRAW_INVALIDATED",
]);

const SCOUT_ACTIONS = new Set(["SESSION_SCOUT_ASSIGNED", "SESSION_SCOUT_REVOKED"]);

const ADMIN_ACTIONS = new Set([
  "MEMBER_CREATED",
  "MEMBER_DEACTIVATED",
  "MEMBER_REACTIVATED",
  "MEMBER_ROLE_CHANGED",
  "MEMBER_MODALITY_CHANGED",
  "MEMBER_RATING_CHANGED",
  "PASSWORD_RESET",
  "GROUP_SETTINGS_UPDATED",
  "SESSION_CREATED",
  "SESSION_SCHEDULE_UPDATED",
  "SESSION_CANCELLED",
  "SESSION_FINISHED",
  "DEV_RESET_MATCHES",
  "DEV_RESET_DRAW_AND_MATCHES",
  "PUSH_TEST_SENT",
]);

const AUTH_ACTIONS = new Set(["PASSWORD_CHANGED", "USER_PROFILE_UPDATED", "AUTHZ_DENIED"]);

const SYSTEM_ACTIONS = new Set([
  "SYSTEM_BOOTSTRAPPED",
  "SESSION_REGISTRATION_OPENED",
  "SESSION_PRIORITY_CLOSED",
  "OPERATION_FAILED",
]);

/** Classifica action string (incluindo legado desconhecido). */
export function categorizeAuditAction(action: string): AuditCategory {
  if (MATCH_ACTIONS.has(action)) return "MATCH";
  if (ATTENDANCE_ACTIONS.has(action)) return "ATTENDANCE";
  if (DRAW_ACTIONS.has(action)) return "DRAW";
  if (SCOUT_ACTIONS.has(action)) return "SCOUT";
  if (ADMIN_ACTIONS.has(action)) return "ADMIN";
  if (AUTH_ACTIONS.has(action)) return "AUTH";
  if (SYSTEM_ACTIONS.has(action)) return "SYSTEM";
  if (action.startsWith("MATCH_")) return "MATCH";
  if (action.startsWith("REGISTRATION_") || action.startsWith("ATTENDANCE_")) return "ATTENDANCE";
  if (action.startsWith("DRAW_")) return "DRAW";
  if (action.startsWith("SESSION_SCOUT_")) return "SCOUT";
  if (action.startsWith("MEMBER_") || action.startsWith("SESSION_")) return "ADMIN";
  return "OTHER";
}

/** Actions pertencentes a uma categoria (para filtro SQL). */
export function actionsForCategory(category: AuditCategory): readonly string[] {
  switch (category) {
    case "MATCH":
      return [...MATCH_ACTIONS];
    case "ATTENDANCE":
      return [...ATTENDANCE_ACTIONS];
    case "DRAW":
      return [...DRAW_ACTIONS];
    case "SCOUT":
      return [...SCOUT_ACTIONS];
    case "ADMIN":
      return [...ADMIN_ACTIONS];
    case "AUTH":
      return [...AUTH_ACTIONS];
    case "SYSTEM":
      return [...SYSTEM_ACTIONS];
    case "OTHER":
      return [];
  }
}

export function resolveAuditOutcome(raw: string | null | undefined): AuditOutcome {
  if (raw === "FAILURE" || raw === "DENIED" || raw === "SUCCESS") return raw;
  return "SUCCESS";
}

export function resolveAuditSeverity(raw: string | null | undefined, outcome: AuditOutcome): AuditSeverity {
  if (raw === "INFO" || raw === "WARN" || raw === "ERROR") return raw;
  if (outcome === "DENIED") return "WARN";
  if (outcome === "FAILURE") return "ERROR";
  return "INFO";
}

/** Mapeia commandType de partida → AuditAction de falha correspondente. */
export function matchCommandToAuditAction(commandType: string): string {
  switch (commandType) {
    case "MATCH_PAUSE":
      return "MATCH_PAUSED";
    case "MATCH_RESUME":
      return "MATCH_RESUMED";
    case "MATCH_FINISH":
      return "MATCH_FINISHED";
    case "MATCH_KICKOFF":
    case "MATCH_KICKOFF_WITH_TEAMS":
      return "MATCH_KICKOFF";
    case "MATCH_START_CLOCK":
      return "MATCH_STARTED";
    case "MATCH_EVENT":
      return "MATCH_EVENT_RECORDED";
    case "MATCH_EVENT_VOID":
      return "MATCH_EVENT_VOIDED";
    case "MATCH_SUBSTITUTE":
      return "MATCH_PLAYER_SUBSTITUTED";
    case "MATCH_CANCEL_AWAITING":
      return "MATCH_CANCELLED";
    default:
      return "OPERATION_FAILED";
  }
}

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|credential|hash/i;

/** Remove campos sensíveis de JSON antes de persistir/exibir. */
export function redactAuditJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactAuditJson);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactAuditJson(nested);
  }
  return out;
}
