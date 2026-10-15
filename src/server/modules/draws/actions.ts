"use server";

import { refresh } from "next/cache";
import { requireAdminAction, requireViewer } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import { castVote, closeVoting, generateDraw, invalidateDraw, resolveTie, setOverflowMode, setRotating } from "./service";

export type DrawActionState = { status: "error"; error: string } | { status: "done"; message: string } | undefined;

const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";
const REASON_MAX_LENGTH = 300;
const INVALID = { status: "error", error: "Requisição inválida." } as const;

function failure(scope: string, error: unknown): DrawActionState {
  if (error instanceof UserFacingError) return { status: "error", error: error.message };
  console.error(scope, error);
  return { status: "error", error: UNEXPECTED_ERROR };
}

function readReason(formData: FormData): string | null {
  const reason = formText(formData, "reason").trim().replace(/\s+/g, " ");
  return reason && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

const REASON_ERROR = { status: "error", error: `Informe o motivo (até ${REASON_MAX_LENGTH} caracteres).` } as const;

export async function castVoteAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireViewer();
  const sessionId = formText(formData, "sessionId");
  const drawId = formText(formData, "drawId");
  const optionId = formText(formData, "optionId");
  if (!isUuid(sessionId) || !isUuid(drawId) || !isUuid(optionId)) return INVALID;
  try {
    await castVote(viewer, sessionId, drawId, optionId);
    refresh();
    return { status: "done", message: "Voto registrado." };
  } catch (error) {
    return failure("castVoteAction", error);
  }
}

export async function generateDrawAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  if (!isUuid(sessionId)) return INVALID;
  try {
    const result = await generateDraw(viewer, sessionId);
    refresh();
    return {
      status: "done",
      message: result.status === "DECIDED" ? "Sorteio gerado e oficializado (opção única)." : "Sorteio gerado. Votação aberta.",
    };
  } catch (error) {
    return failure("generateDrawAction", error);
  }
}

export async function closeVotingAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const drawId = formText(formData, "drawId");
  if (!isUuid(sessionId) || !isUuid(drawId)) return INVALID;
  try {
    const status = await closeVoting(viewer, sessionId, drawId);
    refresh();
    return {
      status: "done",
      message: status === "DECIDED" ? "Votação encerrada. Sorteio oficial definido." : "Votação encerrada em empate.",
    };
  } catch (error) {
    return failure("closeVotingAction", error);
  }
}

export async function resolveTieAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const drawId = formText(formData, "drawId");
  const optionId = formText(formData, "optionId");
  const reason = readReason(formData);
  if (!isUuid(sessionId) || !isUuid(drawId)) return INVALID;
  if (!isUuid(optionId)) return { status: "error", error: "Escolha a opção decidida." };
  if (!reason) return REASON_ERROR;
  try {
    await resolveTie(viewer, sessionId, { drawId, optionId, reason });
    refresh();
    return { status: "done", message: "Empate resolvido. Sorteio oficial definido." };
  } catch (error) {
    return failure("resolveTieAction", error);
  }
}

export async function invalidateDrawAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const drawId = formText(formData, "drawId");
  const reason = readReason(formData);
  const regenerate = formText(formData, "regenerate") === "on";
  if (!isUuid(sessionId) || !isUuid(drawId)) return INVALID;
  if (!reason) return REASON_ERROR;
  try {
    const result = await invalidateDraw(viewer, sessionId, { drawId, reason, regenerate });
    refresh();
    return {
      status: "done",
      message: result.newStatus ? "Sorteio invalidado e novo sorteio gerado." : "Sorteio invalidado.",
    };
  } catch (error) {
    return failure("invalidateDrawAction", error);
  }
}

export async function setOverflowModeAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const mode = formText(formData, "mode");
  if (!isUuid(sessionId) || (mode !== "FIXED_TEAMS" && mode !== "FLEXIBLE_ROTATION")) return INVALID;
  try {
    await setOverflowMode(viewer, sessionId, mode);
    refresh();
    return { status: "done", message: "Formação atualizada." };
  } catch (error) {
    return failure("setOverflowModeAction", error);
  }
}

export async function setRotatingAction(_previous: DrawActionState, formData: FormData): Promise<DrawActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const registrationId = formText(formData, "registrationId");
  const rotating = formText(formData, "rotating");
  if (!isUuid(sessionId) || !isUuid(registrationId) || (rotating !== "true" && rotating !== "false")) return INVALID;
  try {
    await setRotating(viewer, sessionId, registrationId, rotating === "true");
    refresh();
    return undefined;
  } catch (error) {
    return failure("setRotatingAction", error);
  }
}
