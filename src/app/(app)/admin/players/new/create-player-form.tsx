"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import { createPlayerAction } from "@/server/modules/members/actions";
import { NAME_MAX_LENGTH, NICKNAME_MAX_LENGTH } from "@/server/modules/members/validation";
import { TemporaryPassword } from "../temporary-password";

export function CreatePlayerForm({ monthlyBlockedReason }: { monthlyBlockedReason: string | null }) {
  const [state, formAction, pending] = useActionState(createPlayerAction, undefined);
  const values = state?.status === "error" ? state.values : undefined;
  const defaultModality = monthlyBlockedReason ? "DAILY" : "MONTHLY";

  return (
    <div className="flex flex-col gap-4">
      {state?.status === "created" && (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.created.name} foi cadastrado.{" "}
            <Link href={`/admin/players/${state.created.memberId}`} className="font-medium underline">
              Ver jogador
            </Link>
          </p>
          <TemporaryPassword username={state.created.username} password={state.created.temporaryPassword} />
        </div>
      )}

      <form
        action={formAction}
        autoComplete="off"
        className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4"
      >
        <TextField label="Nome" name="name" maxLength={NAME_MAX_LENGTH} defaultValue={values?.name} required />
        <TextField
          label="Usuário"
          name="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
          defaultValue={values?.username}
          hint="Usado no login. Minúsculas, números, ponto, hífen ou sublinhado."
          required
        />
        <TextField
          label="Apelido (opcional)"
          name="nickname"
          maxLength={NICKNAME_MAX_LENGTH}
          defaultValue={values?.nickname}
        />
        <TextField
          label="Data de nascimento (opcional)"
          name="birthDate"
          type="date"
          defaultValue={values?.birthDate}
          hint="Usada na Panela de Aniversário."
        />
        <SelectField
          label="Modalidade"
          name="modality"
          defaultValue={values?.modality ?? defaultModality}
          options={[
            { value: "MONTHLY", label: "Mensalista", disabled: monthlyBlockedReason !== null },
            { value: "DAILY", label: "Diarista" },
          ]}
          hint={monthlyBlockedReason ?? undefined}
        />
        <SelectField
          label="Nota base"
          name="baseRating"
          defaultValue={values?.baseRating ?? "3"}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          hint="Visível só para administradores."
        />
        <FormError message={state?.status === "error" ? state.error : undefined} />
        <SubmitButton pending={pending} label="Cadastrar jogador" pendingLabel="Cadastrando…" />
      </form>
    </div>
  );
}
