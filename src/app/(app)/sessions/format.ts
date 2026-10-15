import type { SessionPhase } from "@/server/modules/sessions/queries";

export function formatDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(instant);
}

export function formatSessionTitle(startsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(startsAt);
}

export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(instant);
}

export function phaseDescription(
  phase: SessionPhase,
  session: { registrationOpensAt: Date; priorityDeadlineAt: Date; cancelReason: string | null },
  timeZone: string,
): string {
  switch (phase) {
    case "SCHEDULED":
      return `A lista abre ${formatDateTime(session.registrationOpensAt, timeZone)}.`;
    case "PRIORITY":
      return `Lista aberta. Prioridade dos mensalistas até ${formatDateTime(session.priorityDeadlineAt, timeZone)}.`;
    case "GENERAL":
      return "Lista aberta para todos, por ordem de confirmação.";
    case "CLOSED":
      return "Sessão encerrada.";
    case "CANCELLED":
      return `Sessão cancelada${session.cancelReason ? `: ${session.cancelReason}` : "."}`;
  }
}

export function displayName(registration: { member: { nickname: string | null; user: { name: string } } }): string {
  return registration.member.nickname
    ? `${registration.member.user.name} (${registration.member.nickname})`
    : registration.member.user.name;
}
