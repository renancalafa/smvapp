"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { isMatchEventType } from "@/domain/match/events";
import { requireAdminAction } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { ConflictError, UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import {
  addHistoricalMatchEvent,
  correctHistoricalMatchEvent,
  voidHistoricalMatchEvent,
} from "./historical-corrections";
import {
  getFinishedMatchCorrectionDetail,
  type MatchCorrectionDetail,
} from "./historical-queries";
import type { MatchView } from "./view";

export type HistoricalCorrectionState =
  | { status: "error"; error: string }
  | { status: "conflict"; error: string; current: unknown }
  | { status: "done"; message: string; match: MatchView }
  | undefined;

const UNEXPECTED = "Não foi possível concluir a correção. Tente novamente.";

function failure(scope: string, error: unknown): HistoricalCorrectionState {
  if (error instanceof ConflictError) {
    return { status: "conflict", error: error.message, current: error.current };
  }
  if (error instanceof UserFacingError) return { status: "error", error: error.message };
  console.error(scope, error);
  return { status: "error", error: UNEXPECTED };
}

function readOperationId(formData: FormData): string {
  const fromForm = formText(formData, "operationId");
  return isUuid(fromForm) ? fromForm : randomUUID();
}

function readVersion(formData: FormData): number | null {
  const raw = formText(formData, "expectedVersion");
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function readOptionalAssist(formData: FormData): string | null {
  const raw = formText(formData, "assistMemberId").trim();
  if (!raw) return null;
  return isUuid(raw) ? raw : null;
}

export type MatchCorrectionDetailResult =
  | { ok: true; detail: MatchCorrectionDetail }
  | { ok: false; error: string };

/** ADMIN only — carrega partida finalizada para o painel de correção. */
export async function loadMatchCorrectionDetailAction(
  sessionId: string,
  matchId: string,
): Promise<MatchCorrectionDetailResult> {
  try {
    const viewer = await requireAdminAction();
    if (!isUuid(sessionId) || !isUuid(matchId)) {
      return { ok: false, error: "Partida inválida." };
    }
    const detail = await getFinishedMatchCorrectionDetail(viewer.group.id, sessionId, matchId);
    if (!detail) return { ok: false, error: "Partida finalizada não encontrada." };
    return { ok: true, detail };
  } catch (error) {
    if (error instanceof UserFacingError) return { ok: false, error: error.message };
    console.error("loadMatchCorrectionDetailAction", error);
    return { ok: false, error: UNEXPECTED };
  }
}

/** ADMIN only — scouts e jogadores são rejeitados em requireAdminAction. */
export async function addHistoricalMatchEventAction(
  _previous: HistoricalCorrectionState,
  formData: FormData,
): Promise<HistoricalCorrectionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const memberId = formText(formData, "memberId");
  const typeRaw = formText(formData, "type");
  const reason = formText(formData, "reason");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || !isUuid(memberId) || expectedVersion == null) {
    return { status: "error", error: "Dados da correção incompletos." };
  }
  if (!isMatchEventType(typeRaw)) return { status: "error", error: "Tipo de evento inválido." };
  if (!reason.trim()) return { status: "error", error: "Informe o motivo da correção." };

  try {
    const viewer = await requireAdminAction();
    const match = await addHistoricalMatchEvent(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
      type: typeRaw,
      memberId,
      assistMemberId: readOptionalAssist(formData),
      reason,
    });
    refresh();
    return { status: "done", message: "Evento histórico adicionado.", match };
  } catch (error) {
    return failure("addHistoricalMatchEventAction", error);
  }
}

export async function voidHistoricalMatchEventAction(
  _previous: HistoricalCorrectionState,
  formData: FormData,
): Promise<HistoricalCorrectionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const eventId = formText(formData, "eventId");
  const reason = formText(formData, "reason");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || !isUuid(eventId) || expectedVersion == null) {
    return { status: "error", error: "Dados da correção incompletos." };
  }
  if (!reason.trim()) return { status: "error", error: "Informe o motivo da correção." };

  try {
    const viewer = await requireAdminAction();
    const match = await voidHistoricalMatchEvent(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
      eventId,
      reason,
    });
    refresh();
    return { status: "done", message: "Evento histórico anulado.", match };
  } catch (error) {
    return failure("voidHistoricalMatchEventAction", error);
  }
}

export async function correctHistoricalMatchEventAction(
  _previous: HistoricalCorrectionState,
  formData: FormData,
): Promise<HistoricalCorrectionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const eventId = formText(formData, "eventId");
  const memberId = formText(formData, "memberId");
  const typeRaw = formText(formData, "type");
  const reason = formText(formData, "reason");
  const expectedVersion = readVersion(formData);
  if (
    !isUuid(sessionId) ||
    !isUuid(matchId) ||
    !isUuid(eventId) ||
    !isUuid(memberId) ||
    expectedVersion == null
  ) {
    return { status: "error", error: "Dados da correção incompletos." };
  }
  if (!reason.trim()) return { status: "error", error: "Informe o motivo da correção." };
  const type = typeRaw && isMatchEventType(typeRaw) ? typeRaw : undefined;

  try {
    const viewer = await requireAdminAction();
    const match = await correctHistoricalMatchEvent(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
      eventId,
      memberId,
      assistMemberId: formData.has("assistMemberId") ? readOptionalAssist(formData) : undefined,
      type,
      reason,
    });
    refresh();
    return { status: "done", message: "Evento histórico corrigido.", match };
  } catch (error) {
    return failure("correctHistoricalMatchEventAction", error);
  }
}
