"use server";

import { refresh } from "next/cache";
import { requireAdminAction } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { createPlayer, resetPlayerPassword, setMemberStatus, type CreatedPlayer } from "./service";
import { isUuid, readCreatePlayerForm, validateCreatePlayer, type CreatePlayerFormValues } from "./validation";

export type CreatePlayerState =
  | { status: "error"; error: string; values: CreatePlayerFormValues }
  | { status: "created"; created: CreatedPlayer }
  | undefined;

export type MemberActionState =
  | { status: "error"; error: string }
  | { status: "done"; message: string; temporaryPassword?: string }
  | undefined;

const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";

function errorMessage(scope: string, error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(scope, error);
  return UNEXPECTED_ERROR;
}

export async function createPlayerAction(
  _previous: CreatePlayerState,
  formData: FormData,
): Promise<CreatePlayerState> {
  const viewer = await requireAdminAction();
  const values = readCreatePlayerForm(formData);
  const parsed = validateCreatePlayer(values);
  if (!parsed.ok) return { status: "error", error: parsed.error, values };
  try {
    const created = await createPlayer(viewer, parsed.input);
    refresh();
    return { status: "created", created };
  } catch (error) {
    return { status: "error", error: errorMessage("createPlayerAction", error), values };
  }
}

export async function setMemberStatusAction(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireAdminAction();
  const memberId = formText(formData, "memberId");
  const status = formText(formData, "status");
  if (!isUuid(memberId) || (status !== "ACTIVE" && status !== "INACTIVE")) {
    return { status: "error", error: "Requisição inválida." };
  }
  try {
    const result = await setMemberStatus(viewer, memberId, status);
    refresh();
    const released =
      result.releasedSessions > 0 ? ` Saiu de ${result.releasedSessions} sessão(ões) futura(s); a fila foi promovida.` : "";
    return {
      status: "done",
      message: status === "ACTIVE" ? "Jogador ativado." : `Jogador desativado.${released}`,
    };
  } catch (error) {
    return { status: "error", error: errorMessage("setMemberStatusAction", error) };
  }
}

export async function resetPasswordAction(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireAdminAction();
  const memberId = formText(formData, "memberId");
  if (!isUuid(memberId)) return { status: "error", error: "Requisição inválida." };
  try {
    const temporaryPassword = await resetPlayerPassword(viewer, memberId);
    refresh();
    return {
      status: "done",
      message: "Senha redefinida. As sessões abertas do jogador foram encerradas.",
      temporaryPassword,
    };
  } catch (error) {
    return { status: "error", error: errorMessage("resetPasswordAction", error) };
  }
}
