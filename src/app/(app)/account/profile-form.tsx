"use client";

import { useActionState } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkCardPad,
  darkControl,
  darkHint,
  darkLabel,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { updateOwnProfileAction } from "@/server/modules/members/actions";
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
} from "@/server/modules/members/validation";

export function ProfileForm({
  username,
  name,
  nickname,
  email,
}: {
  username: string;
  name: string;
  nickname: string | null;
  email: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateOwnProfileAction, undefined);
  const values = state?.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className={`flex flex-col gap-4 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Dados pessoais</h2>
        <p className={`mt-1 ${darkMuted}`}>
          Nome e apelido aparecem nas listas, times e rankings. O email é só contato — o login continua pelo
          usuário.
        </p>
      </div>

      <label className={darkLabel}>
        Usuário
        <input
          value={username}
          readOnly
          className={`${darkControl} cursor-default opacity-80`}
          autoComplete="username"
        />
        <span className={darkHint}>Usado no login. Não pode ser alterado aqui.</span>
      </label>

      <TextField
        label="Nome completo"
        name="name"
        maxLength={NAME_MAX_LENGTH}
        defaultValue={values?.name ?? name}
        required
        autoComplete="name"
      />
      <TextField
        label="Apelido (opcional)"
        name="nickname"
        maxLength={NICKNAME_MAX_LENGTH}
        defaultValue={values?.nickname ?? nickname ?? ""}
        autoComplete="nickname"
      />
      <TextField
        label="Email (opcional)"
        name="email"
        type="email"
        maxLength={EMAIL_MAX_LENGTH}
        defaultValue={values?.email ?? email ?? ""}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        hint="Opcional. Guardado em minúsculas."
      />

      <SubmitButton pending={pending} label="Salvar dados" pendingLabel="Salvando…" />
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </form>
  );
}
