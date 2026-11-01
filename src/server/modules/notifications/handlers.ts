import "server-only";
import { isAllowedPushEndpoint, parsePushSubscriptionInput } from "@/domain/push/subscription";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
  webPushSender,
  type PushSender,
} from "./push";

// Lógica das Server Actions de push, separada de next/headers para os scripts de checagem.

export type PushActionResult = { status: "error"; error: string } | { status: "done"; message: string };

type Actor = Pick<Viewer, "user" | "group"> | null;

const NOT_AUTHENTICATED: PushActionResult = {
  status: "error",
  error: "Entre de novo na sua conta para gerenciar as notificações.",
};
const INVALID_SUBSCRIPTION: PushActionResult = {
  status: "error",
  error: "Este navegador enviou uma inscrição de notificações inválida.",
};
const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";

function authorizedUserId(viewer: Actor): string | null {
  if (!viewer || viewer.user.mustChangePassword) return null;
  return viewer.user.id;
}

function failure(scope: string, error: unknown): PushActionResult {
  if (error instanceof UserFacingError) return { status: "error", error: error.message };
  console.error(scope, error);
  return { status: "error", error: UNEXPECTED_ERROR };
}

export async function handleSubscribePush(
  viewer: Actor,
  raw: unknown,
  userAgent: string | null,
  replacesEndpoint: unknown = null,
): Promise<PushActionResult> {
  const userId = authorizedUserId(viewer);
  if (!userId) return NOT_AUTHENTICATED;
  const input = parsePushSubscriptionInput(raw);
  if (!input) return INVALID_SUBSCRIPTION;
  // Endpoint antigo inválido é ignorado: no pior caso fica uma linha morta, apagada no próximo 404/410.
  const replaces =
    typeof replacesEndpoint === "string" && isAllowedPushEndpoint(replacesEndpoint) ? replacesEndpoint : null;
  try {
    await savePushSubscription(userId, input, userAgent, replaces);
    return { status: "done", message: "Notificações ativadas neste aparelho." };
  } catch (error) {
    return failure("handleSubscribePush", error);
  }
}

export async function handleUnsubscribePush(viewer: Actor, endpoint: unknown): Promise<PushActionResult> {
  const userId = authorizedUserId(viewer);
  if (!userId) return NOT_AUTHENTICATED;
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) return INVALID_SUBSCRIPTION;
  try {
    await removePushSubscription(userId, endpoint);
    return { status: "done", message: "Notificações desativadas neste aparelho." };
  } catch (error) {
    return failure("handleUnsubscribePush", error);
  }
}

export async function handleSendTestPush(
  viewer: Actor,
  endpoint: unknown,
  send: PushSender = webPushSender,
): Promise<PushActionResult> {
  const userId = authorizedUserId(viewer);
  if (!userId || !viewer) return NOT_AUTHENTICATED;
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) return INVALID_SUBSCRIPTION;
  try {
    const outcome = await sendTestPush({ userId, groupId: viewer.group.id }, endpoint, send);
    if (outcome.status === "cooldown") {
      return {
        status: "error",
        error: `Aguarde ${outcome.retryAfterSec} s para enviar outro teste a este aparelho.`,
      };
    }
    if (outcome.status === "expired") {
      return {
        status: "error",
        error: "A inscrição deste aparelho expirou e foi removida. Desative e ative as notificações de novo.",
      };
    }
    return { status: "done", message: "Notificação de teste enviada. Ela deve chegar em alguns segundos." };
  } catch (error) {
    return failure("handleSendTestPush", error);
  }
}

/**
 * Logout explícito: remove só a inscrição deste aparelho (endpoint enviado pelo formulário
 * de saída) e só se for do usuário da sessão. Nunca lança; o logout segue de qualquer jeito.
 */
export async function cleanupPushOnLogout(userId: string | null, endpoint: unknown): Promise<void> {
  if (!userId || typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) return;
  try {
    await removePushSubscription(userId, endpoint);
  } catch (error) {
    console.error("cleanupPushOnLogout", error);
  }
}
