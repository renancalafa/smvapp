"use server";

import { refresh } from "next/cache";
import { requireAdminAction, requireViewer } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import {
  adminIncludeMember,
  adminPromoteRegistration,
  adminRemoveRegistration,
  markAttendance,
  respondToSession,
} from "./service";

export type SessionActionState = { status: "error"; error: string } | { status: "done"; message: string } | undefined;

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
    return { status: "done", message: "Jogador incluído como participante." };
  } catch (error) {
    return failure("adminIncludeAction", error);
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
