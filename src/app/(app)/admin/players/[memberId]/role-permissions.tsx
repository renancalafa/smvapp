"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SubmitButton } from "@/components/form-fields";
import type { MemberRole } from "@/generated/prisma/enums";
import { changeMemberRoleAction } from "@/server/modules/members/actions";
import { ROLE_LABEL } from "../../../labels";

const PROMOTE_CONFIRM =
  "Promover este jogador a ADMIN?\n\n" +
  "Ele poderá: gerenciar jogadores e permissões, sessões, sorteios, Modo Pelada, " +
  "estatísticas administrativas e configurações do grupo.\n\n" +
  "Modalidade, nota, presença e histórico permanecem iguais.";

const DEMOTE_CONFIRM =
  "Rebaixar este administrador a JOGADOR?\n\n" +
  "Ele perderá o acesso às telas e ações de ADMIN (jogadores, sessões, sorteio, " +
  "Modo Pelada administrativo, configurações).\n\n" +
  "Continuará podendo confirmar presença, votar e ver placar/estatísticas.\n\n" +
  "Modalidade, nota, presença e histórico permanecem iguais.\n\n" +
  "Não é possível rebaixar o último administrador ativo do grupo.";

function confirmSubmit(message: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(message)) event.preventDefault();
  };
}

export function RolePermissions({
  memberId,
  username,
  role,
}: {
  memberId: string;
  username: string;
  role: MemberRole;
}) {
  const [state, formAction, pending] = useActionState(changeMemberRoleAction, undefined);
  const nextRole: MemberRole = role === "PLAYER" ? "ADMIN" : "PLAYER";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Permissões</h2>
      <p className="text-sm text-zinc-500">
        Papel atual: <span className="font-medium text-zinc-800">{ROLE_LABEL[role]}</span> ({username}).
        A mudança vale no próximo request autenticado (sessões abertas continuam válidas, mas o
        papel é relido do banco).
      </p>
      <form
        action={formAction}
        onSubmit={confirmSubmit(nextRole === "ADMIN" ? PROMOTE_CONFIRM : DEMOTE_CONFIRM)}
      >
        <input type="hidden" name="memberId" value={memberId} />
        <input type="hidden" name="role" value={nextRole} />
        <SubmitButton
          pending={pending}
          label={nextRole === "ADMIN" ? "Promover a administrador" : "Rebaixar a jogador"}
          pendingLabel="Atualizando…"
          variant={nextRole === "ADMIN" ? "primary" : "danger"}
        />
      </form>
      {state?.status === "done" && <p className="text-sm text-emerald-700">{state.message}</p>}
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
