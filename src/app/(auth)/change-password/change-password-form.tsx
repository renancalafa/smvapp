"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/server/auth/actions";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/validation";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";

export function ChangePasswordForm({ username }: { username: string }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, undefined);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {/* Ajuda gerenciadores de senha a associar a nova senha ao usuário. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <TextField
        label="Senha atual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        label="Nova senha"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        required
      />
      <TextField
        label="Confirme a nova senha"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        required
      />
      <p className="text-xs text-zinc-500">
        De {PASSWORD_MIN_LENGTH} a {PASSWORD_MAX_LENGTH} caracteres, diferente do usuário e da senha atual.
      </p>
      <FormError message={state?.error} />
      <SubmitButton pending={pending} label="Salvar nova senha" pendingLabel="Salvando…" />
    </form>
  );
}
