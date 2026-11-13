"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { isMatchEventType, MATCH_EVENT_LABELS } from "@/domain/match/events";
import { requireMatchOperatorAction } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { ConflictError, UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import {
  cancelAwaitingMatch,
  confirmMatchTeams,
  finishMatch,
  kickoffMatchWithTeams,
  pauseMatch,
  recordMatchEvent,
  resumeMatch,
  setPenaltyWinner,
  startMatchClock,
  substituteMatchPlayer,
  substituteSessionTeamPlayer,
  voidMatchEvent,
} from "./service";
import type { MatchView } from "./view";

export type MatchActionState =
  | { status: "error"; error: string }
  | { status: "conflict"; error: string; current: unknown }
  | { status: "done"; message: string; match?: MatchView }
  | undefined;

export type SessionRosterActionState =
  | { status: "error"; error: string }
  | { status: "done"; message: string }
  | undefined;

const UNEXPECTED = "Não foi possível concluir agora. Tente novamente em instantes.";

function failure(scope: string, error: unknown): MatchActionState {
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

export async function confirmMatchTeamsAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const teamAId = formText(formData, "teamAId");
  const teamBId = formText(formData, "teamBId");
  const expectedSequence = Number(formText(formData, "expectedSequence"));
  if (
    !isUuid(sessionId) ||
    !isUuid(teamAId) ||
    !isUuid(teamBId) ||
    !Number.isInteger(expectedSequence) ||
    expectedSequence < 1
  ) {
    return { status: "error", error: "Escolha os dois times da partida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await confirmMatchTeams(viewer, sessionId, {
      operationId: readOperationId(formData),
      expectedSequence,
      teamAId,
      teamBId,
    });
    refresh();
    return {
      status: "done",
      message: "Times confirmados. O cronômetro só começa quando você apitar.",
      match,
    };
  } catch (error) {
    return failure("confirmMatchTeamsAction", error);
  }
}

export async function startMatchClockAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await startMatchClock(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return {
      status: "done",
      message:
        match.sequence === 1
          ? "Cronômetro ligado. A lista de presença ficou travada."
          : "Cronômetro ligado.",
      match,
    };
  } catch (error) {
    return failure("startMatchClockAction", error);
  }
}

/** Apito: persiste o confronto escolhido e liga o cronômetro na mesma operação. */
export async function kickoffMatchWithTeamsAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const teamAId = formText(formData, "teamAId");
  const teamBId = formText(formData, "teamBId");
  const expectedSequence = Number(formText(formData, "expectedSequence"));
  if (
    !isUuid(sessionId) ||
    !isUuid(teamAId) ||
    !isUuid(teamBId) ||
    !Number.isInteger(expectedSequence) ||
    expectedSequence < 1
  ) {
    return { status: "error", error: "Escolha os dois times da partida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await kickoffMatchWithTeams(viewer, sessionId, {
      operationId: readOperationId(formData),
      expectedSequence,
      teamAId,
      teamBId,
    });
    // Sem refresh(): /live já faz poll e o cliente sobe o MatchView do retorno (evita remount).
    return {
      status: "done",
      message:
        match.sequence === 1
          ? "Partida iniciada. A lista de presença ficou travada."
          : "Partida iniciada.",
      match,
    };
  } catch (error) {
    return failure("kickoffMatchWithTeamsAction", error);
  }
}

export async function cancelAwaitingMatchAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    await cancelAwaitingMatch(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Escolha de times cancelada." };
  } catch (error) {
    return failure("cancelAwaitingMatchAction", error);
  }
}

export async function pauseMatchAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await pauseMatch(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Partida pausada.", match };
  } catch (error) {
    return failure("pauseMatchAction", error);
  }
}

export async function resumeMatchAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await resumeMatch(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Partida retomada.", match };
  } catch (error) {
    return failure("resumeMatchAction", error);
  }
}

function readNonNegativeInt(formData: FormData, key: string): number | null {
  const raw = formText(formData, key);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export async function finishMatchAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const expectedVersion = readVersion(formData);
  const expectedScoreA = readNonNegativeInt(formData, "expectedScoreA");
  const expectedScoreB = readNonNegativeInt(formData, "expectedScoreB");
  if (
    !isUuid(sessionId) ||
    !isUuid(matchId) ||
    expectedVersion === null ||
    expectedScoreA === null ||
    expectedScoreB === null
  ) {
    return { status: "error", error: "Requisição inválida." };
  }
  const penaltyRaw = formText(formData, "penaltyWinnerTeamId").trim();
  const penaltyWinnerTeamId = penaltyRaw ? penaltyRaw : null;
  if (penaltyWinnerTeamId && !isUuid(penaltyWinnerTeamId)) {
    return { status: "error", error: "Vencedor dos pênaltis inválido." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await finishMatch(viewer, sessionId, {
      matchId,
      expectedVersion,
      expectedScoreA,
      expectedScoreB,
      penaltyWinnerTeamId,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Partida finalizada.", match };
  } catch (error) {
    return failure("finishMatchAction", error);
  }
}

export async function substituteMatchPlayerAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const outMemberId = formText(formData, "outMemberId");
  const inMemberId = formText(formData, "inMemberId");
  const expectedVersion = readVersion(formData);
  if (
    !isUuid(sessionId) ||
    !isUuid(matchId) ||
    !isUuid(outMemberId) ||
    !isUuid(inMemberId) ||
    expectedVersion === null
  ) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await substituteMatchPlayer(viewer, sessionId, {
      matchId,
      expectedVersion,
      outMemberId,
      inMemberId,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Substituição registrada.", match };
  } catch (error) {
    return failure("substituteMatchPlayerAction", error);
  }
}

/** Pré-apito: troca SessionTeamPlayer (escalação da noite). */
export async function substituteSessionTeamPlayerAction(
  _previous: SessionRosterActionState,
  formData: FormData,
): Promise<SessionRosterActionState> {
  const sessionId = formText(formData, "sessionId");
  const outMemberId = formText(formData, "outMemberId");
  const inMemberId = formText(formData, "inMemberId");
  if (!isUuid(sessionId) || !isUuid(outMemberId) || !isUuid(inMemberId)) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    await substituteSessionTeamPlayer(viewer, sessionId, { outMemberId, inMemberId });
    refresh();
    return { status: "done", message: "Escalação da noite atualizada." };
  } catch (error) {
    if (error instanceof UserFacingError) return { status: "error", error: error.message };
    console.error("substituteSessionTeamPlayerAction", error);
    return { status: "error", error: UNEXPECTED };
  }
}

export async function setPenaltyWinnerAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const teamId = formText(formData, "teamId");
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || !isUuid(teamId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await setPenaltyWinner(viewer, sessionId, {
      matchId,
      teamId,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Vencedor nos pênaltis registrado.", match };
  } catch (error) {
    return failure("setPenaltyWinnerAction", error);
  }
}

export async function recordMatchEventAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const memberId = formText(formData, "memberId");
  const typeRaw = formText(formData, "type");
  const assist = formText(formData, "assistMemberId");
  const expectedVersion = readVersion(formData);
  if (
    !isUuid(sessionId) ||
    !isUuid(matchId) ||
    !isUuid(memberId) ||
    expectedVersion === null ||
    !isMatchEventType(typeRaw)
  ) {
    return { status: "error", error: "Requisição inválida." };
  }
  if (assist && !isUuid(assist)) return { status: "error", error: "Assistência inválida." };
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await recordMatchEvent(viewer, sessionId, {
      matchId,
      expectedVersion,
      operationId: readOperationId(formData),
      type: typeRaw,
      memberId,
      assistMemberId: assist || null,
    });
    refresh();
    return { status: "done", message: `${MATCH_EVENT_LABELS[typeRaw]} registrado.`, match };
  } catch (error) {
    return failure("recordMatchEventAction", error);
  }
}

export async function voidMatchEventAction(
  _previous: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const sessionId = formText(formData, "sessionId");
  const matchId = formText(formData, "matchId");
  const eventId = formText(formData, "eventId");
  const reason = formText(formData, "reason").trim();
  const expectedVersion = readVersion(formData);
  if (!isUuid(sessionId) || !isUuid(matchId) || !isUuid(eventId) || expectedVersion === null) {
    return { status: "error", error: "Requisição inválida." };
  }
  if (!reason) return { status: "error", error: "Informe o motivo da anulação." };
  const viewer = await requireMatchOperatorAction(sessionId);
  try {
    const match = await voidMatchEvent(viewer, sessionId, {
      matchId,
      eventId,
      reason,
      expectedVersion,
      operationId: readOperationId(formData),
    });
    refresh();
    return { status: "done", message: "Evento anulado.", match };
  } catch (error) {
    return failure("voidMatchEventAction", error);
  }
}
