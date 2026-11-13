import type { AuditCategory, AuditOutcome } from "./catalog";

/** Rótulos curtos em português para a lista principal. */
const ACTION_LABELS: Record<string, string> = {
  SYSTEM_BOOTSTRAPPED: "Sistema inicializado",
  PASSWORD_CHANGED: "Senha alterada",
  USER_PROFILE_UPDATED: "Perfil atualizado",
  MEMBER_CREATED: "Jogador criado",
  MEMBER_DEACTIVATED: "Jogador desativado",
  MEMBER_REACTIVATED: "Jogador reativado",
  MEMBER_ROLE_CHANGED: "Papel alterado",
  MEMBER_MODALITY_CHANGED: "Modalidade alterada",
  MEMBER_RATING_CHANGED: "Nota alterada",
  PASSWORD_RESET: "Senha redefinida",
  GROUP_SETTINGS_UPDATED: "Agenda/configurações atualizadas",
  SESSION_CREATED: "Sessão criada",
  SESSION_SCHEDULE_UPDATED: "Horário da sessão atualizado",
  SESSION_REGISTRATION_OPENED: "Lista de presença aberta",
  SESSION_PRIORITY_CLOSED: "Prioridade dos mensalistas encerrada",
  SESSION_CANCELLED: "Sessão cancelada",
  SESSION_FINISHED: "Sessão encerrada",
  SESSION_SCOUT_ASSIGNED: "Scout atribuído",
  SESSION_SCOUT_REVOKED: "Scout revogado",
  REGISTRATION_CONFIRMED: "Presença confirmada",
  REGISTRATION_ADMIN_CONFIRMED_ON_BEHALF: "Presença confirmada pelo admin",
  REGISTRATION_DECLINED: "Ausência registrada",
  REGISTRATION_WITHDRAWN: "Jogador saiu da lista",
  REGISTRATION_PROMOTED: "Promovido da espera",
  REGISTRATION_DEMOTED: "Voltou para a espera",
  REGISTRATION_ADMIN_INCLUDED: "Incluído pelo admin",
  REGISTRATION_ADMIN_REMOVED: "Removido pelo admin",
  REGISTRATION_ADMIN_PROMOTED: "Promovido pelo admin",
  ATTENDANCE_MARKED: "Presença marcada",
  SESSION_OVERFLOW_MODE_SET: "Modo de overflow definido",
  REGISTRATION_ROTATING_SET: "Rotativo marcado",
  DRAW_GENERATED: "Sorteio gerado",
  DRAW_VOTE_CAST: "Voto no sorteio",
  DRAW_VOTING_CLOSED: "Votação encerrada",
  DRAW_DECIDED: "Sorteio decidido",
  DRAW_INVALIDATED: "Sorteio invalidado",
  MATCH_TEAMS_CONFIRMED: "Times da partida confirmados",
  MATCH_TEAMS_CHANGED: "Times da partida alterados",
  MATCH_KICKOFF: "Partida apitada",
  MATCH_STARTED: "Cronômetro iniciado",
  MATCH_PAUSED: "Partida pausada",
  MATCH_RESUMED: "Partida retomada",
  MATCH_FINISHED: "Partida finalizada",
  MATCH_CANCELLED: "Partida cancelada",
  MATCH_EVENT_RECORDED: "Evento registrado",
  MATCH_EVENT_VOIDED: "Evento anulado",
  MATCH_PENALTY_SET: "Pênaltis registrados",
  MATCH_PLAYER_SUBSTITUTED: "Substituição na partida",
  SESSION_TEAM_PLAYER_SUBSTITUTED: "Substituição na escalação",
  MATCH_COMMAND_CONFLICT: "Conflito na partida",
  AUTHZ_DENIED: "Acesso negado",
  OPERATION_FAILED: "Operação falhou",
  DEV_RESET_MATCHES: "Reset de partidas (dev)",
  DEV_RESET_DRAW_AND_MATCHES: "Reset de sorteio e partidas (dev)",
  PUSH_TEST_SENT: "Push de teste enviado",
};

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  MATCH: "Partidas",
  ATTENDANCE: "Presença",
  DRAW: "Sorteio",
  SCOUT: "Scouts",
  ADMIN: "Admin",
  AUTH: "Auth",
  SYSTEM: "Sistema",
  OTHER: "Outros",
};

export const OUTCOME_LABELS: Record<AuditOutcome, string> = {
  SUCCESS: "Sucesso",
  FAILURE: "Falha",
  DENIED: "Negado",
};

/** Limiar (ms) para contar operação como lenta no resumo. */
export const AUDIT_SLOW_MS = 500;

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ").toLowerCase();
}

export function auditCategoryLabel(category: AuditCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function auditOutcomeLabel(outcome: AuditOutcome): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}
