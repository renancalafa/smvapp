"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction, requireViewer } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import { resetSessionForDev, type DevResetLevel } from "./dev-reset";
import { cancelExtraordinarySession, createExtraordinarySession } from "./extraordinary";
import {
  CANCEL_REASON_MAX_LENGTH,
  parseExtraordinaryForm,
  readExtraordinaryFormValues,
  type ExtraordinaryFormValues,
} from "./extraordinary-input";
import {
  ADMIN_RECLAIM_REQUIRED_MESSAGE,
  adminConfirmOnBehalf,
  adminIncludeMember,
  adminPromoteRegistration,
  adminRemoveRegistration,
  endGameSession,
  markAttendance,
  respondToSession,
} from "./service";

export type SessionActionState = { status: "error"; error: string } | { status: "done"; message: string } | undefined;

export type CreateExtraordinaryActionState =
  | { status: "error"; error: string; values: ExtraordinaryFormValues }
  | undefined;

const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";
const REASON_MAX_LENGTH = 300;

function failure(scope: string, error: unknown): SessionActionState {
  if (error instanceof UserFacingError) return { status: "error", error: error.message };
  console.error(scope, error);
  return { status: "error", error: UNEXPECTED_ERROR };
}

function readReason(formData: FormData): string | null {
  const reason = formText(formData, "reason").trim().replace(/\s+/g, " ");
  return reason && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

const RESPONSE_MESSAGES = {
  PARTICIPANT: "Presença confirmada. Você está na lista!",
  WAITLISTED: "Você entrou na lista de espera. Se abrir vaga, entra automaticamente.",
  WAITLISTED_DAILY_PRIORITY:
    "Você entrou na lista de espera. Antes do prazo, diaristas só entram se um mensalista liberar a vaga com “Não vou” (fila FIFO) — ou se um administrador incluir excepcionalmente. Depois do prazo, as vagas livres seguem a ordem da espera.",
  DECLINED: "Recusa registrada.",
  WITHDRAWN: "Você saiu da lista. Sua vaga foi liberada.",
  REMOVED: "Você foi removido desta sessão.",
} as const;

export async function respondAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireViewer();
  const sessionId = formText(formData, "sessionId");
  const response = formText(formData, "response");
  if (!isUuid(sessionId) || (response !== "CONFIRM" && response !== "DECLINE")) {
    return { status: "error", error: "Requisição inválida." };
  }
  try {
    const result = await respondToSession(viewer, sessionId, response);
    refresh();
    if (result.needsAdminReclaim) {
      return { status: "done", message: ADMIN_RECLAIM_REQUIRED_MESSAGE };
    }
    if (result.status === "WAITLISTED" && result.dailyHeldForPriority) {
      return { status: "done", message: RESPONSE_MESSAGES.WAITLISTED_DAILY_PRIORITY };
    }
    return { status: "done", message: RESPONSE_MESSAGES[result.status] };
  } catch (error) {
    return failure("respondAction", error);
  }
}

export async function adminRemoveAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const registrationId = formText(formData, "registrationId");
  const reason = readReason(formData);
  if (!isUuid(sessionId) || !isUuid(registrationId)) return { status: "error", error: "Requisição inválida." };
  if (!reason) return { status: "error", error: `Informe o motivo (até ${REASON_MAX_LENGTH} caracteres).` };
  try {
    const { promoted } = await adminRemoveRegistration(viewer, sessionId, registrationId, reason);
    refresh();
    return {
      status: "done",
      message: promoted > 0 ? "Jogador removido. A fila foi atualizada." : "Jogador removido.",
    };
  } catch (error) {
    return failure("adminRemoveAction", error);
  }
}

export async function adminPromoteAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const registrationId = formText(formData, "registrationId");
  const reason = readReason(formData);
  if (!isUuid(sessionId) || !isUuid(registrationId)) return { status: "error", error: "Requisição inválida." };
  if (!reason) return { status: "error", error: `Informe o motivo (até ${REASON_MAX_LENGTH} caracteres).` };
  try {
    await adminPromoteRegistration(viewer, sessionId, registrationId, reason);
    refresh();
    return { status: "done", message: "Jogador promovido a participante." };
  } catch (error) {
    return failure("adminPromoteAction", error);
  }
}

export async function adminIncludeAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const memberId = formText(formData, "memberId");
  const replace = formText(formData, "replaceRegistrationId");
  const reason = readReason(formData);
  if (!isUuid(sessionId) || !isUuid(memberId) || (replace && !isUuid(replace))) {
    return { status: "error", error: "Escolha o jogador a incluir." };
  }
  if (!reason) return { status: "error", error: `Informe o motivo (até ${REASON_MAX_LENGTH} caracteres).` };
  try {
    await adminIncludeMember(viewer, sessionId, { memberId, reason, replaceRegistrationId: replace || null });
    refresh();
    return { status: "done", message: "Jogador incluído como participante (intervenção excepcional)." };
  } catch (error) {
    return failure("adminIncludeAction", error);
  }
}

export async function adminConfirmOnBehalfAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const memberId = formText(formData, "memberId");
  const reason = readReason(formData);
  if (!isUuid(sessionId) || !isUuid(memberId)) {
    return { status: "error", error: "Escolha o jogador a confirmar." };
  }
  if (!reason) return { status: "error", error: `Informe o motivo (até ${REASON_MAX_LENGTH} caracteres).` };
  try {
    const result = await adminConfirmOnBehalf(viewer, sessionId, { memberId, reason });
    refresh();
    if (result.status === "PARTICIPANT") {
      return { status: "done", message: "Confirmado pelo jogador: entrou como participante." };
    }
    if (result.status === "WAITLISTED") {
      return {
        status: "done",
        message: result.needsAdminReclaim
          ? `Confirmado pelo jogador: ${ADMIN_RECLAIM_REQUIRED_MESSAGE}`
          : result.dailyHeldForPriority
            ? "Confirmado pelo jogador: diarista na lista de espera até o prazo dos mensalistas."
            : "Confirmado pelo jogador: entrou na lista de espera.",
      };
    }
    return { status: "done", message: `Confirmação registrada (${result.status}).` };
  } catch (error) {
    return failure("adminConfirmOnBehalfAction", error);
  }
}

export async function markAttendanceAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const registrationId = formText(formData, "registrationId");
  const attendance = formText(formData, "attendance");
  if (!isUuid(sessionId) || !isUuid(registrationId) || (attendance !== "PRESENT" && attendance !== "ABSENT")) {
    return { status: "error", error: "Requisição inválida." };
  }
  try {
    await markAttendance(viewer, sessionId, registrationId, attendance);
    refresh();
    return { status: "done", message: "Presença registrada." };
  } catch (error) {
    return failure("markAttendanceAction", error);
  }
}

/** ADMIN: encerra a sessão e congela o placar/histórico para espectadores. */
export async function endSessionAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  if (!isUuid(sessionId)) return { status: "error", error: "Requisição inválida." };
  try {
    const result = await endGameSession(viewer, sessionId);
    refresh();
    return {
      status: "done",
      message: result.alreadyFinished
        ? "Esta sessão já estava encerrada."
        : "Sessão encerrada. Resultados disponíveis no Histórico e em Ao Vivo.",
    };
  } catch (error) {
    return failure("endSessionAction", error);
  }
}

/** SOMENTE desenvolvimento: reset de partidas / sorteio para reteste manual. */
export async function devResetSessionAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const levelRaw = formText(formData, "level");
  const confirmation = formText(formData, "confirmation").trim().toUpperCase();
  const level: DevResetLevel | null =
    levelRaw === "MATCHES" || levelRaw === "DRAW_AND_MATCHES" ? levelRaw : null;
  if (!isUuid(sessionId) || !level) return { status: "error", error: "Requisição inválida." };
  if (confirmation !== "RESETAR") {
    return { status: "error", error: 'Digite RESETAR para confirmar (maiúsculas).' };
  }
  try {
    const result = await resetSessionForDev(viewer, sessionId, level);
    refresh();
    if (level === "MATCHES") {
      return {
        status: "done",
        message: `Partidas resetadas (${result.deletedMatches}). Sorteio e lista preservados — pode confirmar times e apitar de novo.`,
      };
    }
    return {
      status: "done",
      message: `Sorteio e partidas resetados (sorteios: ${result.deletedDraws}, partidas: ${result.deletedMatches}). Lista de presença preservada.`,
    };
  } catch (error) {
    return failure("devResetSessionAction", error);
  }
}

/** ADMIN: agenda sessão EXTRAORDINARY (treino) com snapshot de GroupSettings. */
export async function createExtraordinarySessionAction(
  _previous: CreateExtraordinaryActionState,
  formData: FormData,
): Promise<CreateExtraordinaryActionState> {
  const viewer = await requireAdminAction();
  const values = readExtraordinaryFormValues(formData);
  const parsed = parseExtraordinaryForm(values, viewer.group.timezone);
  if (!parsed.ok) return { status: "error", error: parsed.error, values };
  let sessionId: string;
  try {
    ({ sessionId } = await createExtraordinarySession(viewer, parsed.input));
  } catch (error) {
    if (error instanceof UserFacingError) {
      return { status: "error", error: error.message, values };
    }
    console.error("createExtraordinarySessionAction", error);
    return { status: "error", error: UNEXPECTED_ERROR, values };
  }
  refresh();
  redirect(`/admin/sessions/${sessionId}`);
}

/** ADMIN: cancela sessão extraordinária antes do gameplay. */
export async function cancelExtraordinarySessionAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const reason = formText(formData, "reason").trim().replace(/\s+/g, " ");
  if (!isUuid(sessionId)) return { status: "error", error: "Requisição inválida." };
  if (!reason) return { status: "error", error: `Informe o motivo (até ${CANCEL_REASON_MAX_LENGTH} caracteres).` };
  if (reason.length > CANCEL_REASON_MAX_LENGTH) {
    return { status: "error", error: `O motivo pode ter no máximo ${CANCEL_REASON_MAX_LENGTH} caracteres.` };
  }
  try {
    await cancelExtraordinarySession(viewer, sessionId, reason);
    refresh();
    return { status: "done", message: "Sessão extraordinária cancelada." };
  } catch (error) {
    return failure("cancelExtraordinarySessionAction", error);
  }
}
