"use server";

import { refresh } from "next/cache";
import { requireAdminAction, requireViewer } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import {
  changeMemberRating,
  changeMemberRole,
  createPlayer,
  promoteMemberToMonthly,
  resetPlayerPassword,
  setMemberStatus,
  updateOwnProfile,
  type CreatedPlayer,
} from "./service";
import {
  isUuid,
  readCreatePlayerForm,
  readOwnProfileForm,
  validateCreatePlayer,
  validateOwnProfile,
  type CreatePlayerFormValues,
  type OwnProfileFormValues,
} from "./validation";

function parseBaseRating(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 5) return null;
  return value;
}

export type CreatePlayerState =
  | { status: "error"; error: string; values: CreatePlayerFormValues }
  | { status: "created"; created: CreatedPlayer }
  | undefined;

export type MemberActionState =
  | { status: "error"; error: string }
  | { status: "done"; message: string; temporaryPassword?: string }
  | undefined;

export type OwnProfileActionState =
  | { status: "error"; error: string; values: OwnProfileFormValues }
  | { status: "done"; message: string }
  | undefined;

const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";

function errorMessage(scope: string, error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(scope, error);
  return UNEXPECTED_ERROR;
}

/** Conta: só nome, apelido e email do próprio usuário (whitelist em validateOwnProfile). */
export async function updateOwnProfileAction(
  _previous: OwnProfileActionState,
  formData: FormData,
): Promise<OwnProfileActionState> {
  const viewer = await requireViewer();
  const values = readOwnProfileForm(formData);
  const parsed = validateOwnProfile(values);
  if (!parsed.ok) return { status: "error", error: parsed.error, values };
  try {
    await updateOwnProfile(viewer, parsed.input);
    refresh();
    return { status: "done", message: "Dados pessoais atualizados." };
  } catch (error) {
    return { status: "error", error: errorMessage("updateOwnProfileAction", error), values };
  }
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

export async function changeMemberRoleAction(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireAdminAction();
  const memberId = formText(formData, "memberId");
  const role = formText(formData, "role");
  if (!isUuid(memberId) || (role !== "ADMIN" && role !== "PLAYER")) {
    return { status: "error", error: "Requisição inválida." };
  }
  try {
    const result = await changeMemberRole(viewer, memberId, role);
    refresh();
    if (result.previousRole === result.newRole) {
      return { status: "done", message: "O papel já estava atualizado." };
    }
    return {
      status: "done",
      message:
        result.newRole === "ADMIN"
          ? "Jogador promovido a administrador. As permissões passam a valer no próximo acesso autenticado."
          : "Administrador rebaixado a jogador. As permissões de ADMIN deixam de valer no próximo acesso autenticado.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("changeMemberRoleAction", error) };
  }
}

export async function promoteMemberToMonthlyAction(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireAdminAction();
  const memberId = formText(formData, "memberId");
  if (!isUuid(memberId)) {
    return { status: "error", error: "Requisição inválida." };
  }
  try {
    await promoteMemberToMonthly(viewer, memberId);
    refresh();
    return {
      status: "done",
      message:
        "Jogador promovido a mensalista. Inscrições já feitas nesta e em outras sessões não mudam; a prioridade de mensalista vale nas próximas confirmações.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("promoteMemberToMonthlyAction", error) };
  }
}

export async function changeMemberRatingAction(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const viewer = await requireAdminAction();
  const memberId = formText(formData, "memberId");
  const baseRating = parseBaseRating(formText(formData, "baseRating"));
  if (!isUuid(memberId) || baseRating === null) {
    return { status: "error", error: "Escolha uma nota de 1 a 5." };
  }
  try {
    const result = await changeMemberRating(viewer, memberId, baseRating);
    refresh();
    if (result.previousRating === result.newRating) {
      return { status: "done", message: "A nota já estava atualizada." };
    }
    return {
      status: "done",
      message: `Nota alterada de ${result.previousRating} para ${result.newRating}. Sorteios já feitos não mudam; o próximo usa a nota nova.`,
    };
  } catch (error) {
    return { status: "error", error: errorMessage("changeMemberRatingAction", error) };
  }
}
