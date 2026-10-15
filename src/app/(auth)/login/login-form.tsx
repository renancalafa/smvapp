"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/auth/actions";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <TextField
        label="Usuário"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state?.username}
        required
      />
      <TextField label="Senha" name="password" type="password" autoComplete="current-password" required />
      <FormError message={state?.error} />
      <SubmitButton pending={pending} label="Entrar" pendingLabel="Entrando…" />
    </form>
  );
}
