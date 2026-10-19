"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewerAllowingPasswordChange } from "./dal";
import { clientIpFromHeaders } from "./login-throttle";
import { changePassword, login, logout } from "./service";
import { deleteSessionCookie, readSessionToken, revokeSessionByToken, setSessionCookie } from "./session";
import { formText } from "./validation";

export type LoginFormState = { error: string; username: string } | undefined;
export type ChangePasswordFormState = { error: string } | undefined;

const UNEXPECTED_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const username = formText(formData, "username");
  const password = formText(formData, "password");
  if (!username.trim() || !password) {
    return { error: "Informe usuário e senha.", username };
  }

  const headerList = await headers();
  const userAgent = headerList.get("user-agent");
  const ip = clientIpFromHeaders(headerList);
  let result;
  try {
    const previousToken = await readSessionToken();
    if (previousToken) await revokeSessionByToken(previousToken);
    result = await login({ username, password, userAgent, ip });
  } catch (error) {
    console.error("loginAction", error);
    return { error: UNEXPECTED_ERROR, username };
  }
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60));
      return {
        error: `Muitas tentativas. Aguarde cerca de ${minutes} min e tente de novo.`,
        username,
      };
    }
    return { error: "Usuário ou senha inválidos.", username };
  }

  await setSessionCookie(result.session);
  redirect(result.mustChangePassword ? "/change-password" : "/");
}

export async function changePasswordAction(
  _previous: ChangePasswordFormState,
  formData: FormData,
): Promise<ChangePasswordFormState> {
  const viewer = await requireViewerAllowingPasswordChange();
  const userAgent = (await headers()).get("user-agent");
  let result;
  try {
    result = await changePassword(viewer, {
      currentPassword: formText(formData, "currentPassword"),
      newPassword: formText(formData, "newPassword"),
      confirmation: formText(formData, "confirmation"),
      userAgent,
    });
  } catch (error) {
    console.error("changePasswordAction", error);
    return { error: UNEXPECTED_ERROR };
  }
  if (!result.ok) return { error: result.error };

  await setSessionCookie(result.session);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    try {
      await logout(token);
    } catch (error) {
      // O cookie é apagado mesmo assim; a sessão expira sozinha.
      console.error("logoutAction", error);
    }
  }
  await deleteSessionCookie();
  redirect("/login");
}
