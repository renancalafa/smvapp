"use client";

import { useActionState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { FormError, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import type { MemberRole } from "@/generated/prisma/enums";
import {
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { changeMemberRoleAction } from "@/server/modules/members/actions";
import { ROLE_LABEL } from "../../../labels";

const PROMOTE_DESCRIPTION =
  "Ele poderá gerenciar jogadores e permissões, sessões, sorteios, Modo Pelada, " +
  "estatísticas administrativas e configurações do grupo. Modalidade, nota, presença e histórico permanecem iguais.";

const DEMOTE_DESCRIPTION =
  "Ele perderá o acesso às telas e ações de ADMIN. Continuará podendo confirmar presença, votar e ver placar/estatísticas. " +
  "Não é possível rebaixar o último administrador ativo do grupo.";

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
  const confirmSubmit = useConfirmSubmit();
  const nextRole: MemberRole = role === "PLAYER" ? "ADMIN" : "PLAYER";

  return (
    <div className={`flex flex-col gap-2 ${darkCardPad}`}>
      <ActionToast state={state} successTitle="Permissões atualizadas" errorTitle="Falha ao alterar papel" />
      <h2 className={darkTitleMd}>Permissões</h2>
      <p className={darkMuted}>
        Papel atual: <span className="font-medium text-white">{ROLE_LABEL[role]}</span> ({username}).
        A mudança vale no próximo request autenticado (sessões abertas continuam válidas, mas o
        papel é relido do banco).
      </p>
      <form
        action={formAction}
        onSubmit={confirmSubmit(
          nextRole === "ADMIN"
            ? {
                title: "Promover a administrador?",
                description: PROMOTE_DESCRIPTION,
                confirmLabel: "Promover",
              }
            : {
                title: "Rebaixar a jogador?",
                description: DEMOTE_DESCRIPTION,
                confirmLabel: "Rebaixar",
                tone: "danger",
              },
        )}
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
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
