"use client";

import { useActionState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { FormError, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import type { MemberStatus } from "@/generated/prisma/enums";
import {
  darkAlertSuccess,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { resetPasswordAction, setMemberStatusAction } from "@/server/modules/members/actions";
import { TemporaryPassword } from "../temporary-password";

export function PlayerActions({
  memberId,
  username,
  status,
}: {
  memberId: string;
  username: string;
  status: MemberStatus;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setMemberStatusAction, undefined);
  const [resetState, resetAction, resetPending] = useActionState(resetPasswordAction, undefined);
  const confirmSubmit = useConfirmSubmit();
  const nextStatus: MemberStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  return (
    <div className="flex flex-col gap-4">
      <ActionToast
        state={statusState}
        successTitle="Participação atualizada"
        errorTitle="Falha ao atualizar participação"
      />
      <ActionToast
        state={resetState}
        successTitle="Senha redefinida"
        errorTitle="Falha ao redefinir senha"
      />
      <div className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkTitleMd}>Participação</h2>
        <p className={darkMuted}>
          {status === "ACTIVE"
            ? "Desativar tira o jogador das próximas listas e da divisão da mensalidade. Ele ainda consegue entrar no app e o histórico é mantido."
            : "Ativar devolve o jogador às listas com a modalidade atual."}
        </p>
        <form
          action={statusAction}
          onSubmit={
            nextStatus === "INACTIVE"
              ? confirmSubmit({
                  title: `Desativar ${username}?`,
                  description:
                    "O jogador sai das próximas listas e da divisão da mensalidade. Histórico e login são mantidos.",
                  confirmLabel: "Desativar",
                  tone: "danger",
                })
              : undefined
          }
        >
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="status" value={nextStatus} />
          <SubmitButton
            pending={statusPending}
            label={nextStatus === "INACTIVE" ? "Desativar jogador" : "Ativar jogador"}
            pendingLabel="Salvando…"
            variant={nextStatus === "INACTIVE" ? "danger" : "primary"}
          />
        </form>
        <FormError message={statusState?.status === "error" ? statusState.error : undefined} />
      </div>

      <div className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkTitleMd}>Senha</h2>
        <p className={darkMuted}>
          Gera uma nova senha temporária, encerra todas as sessões do jogador e exige a troca no próximo login.
        </p>
        <form
          action={resetAction}
          onSubmit={confirmSubmit({
            title: `Redefinir a senha de ${username}?`,
            description:
              "Gera uma senha temporária, encerra todas as sessões e exige troca no próximo login.",
            confirmLabel: "Redefinir",
            tone: "danger",
          })}
        >
          <input type="hidden" name="memberId" value={memberId} />
          <SubmitButton
            pending={resetPending}
            label="Redefinir senha"
            pendingLabel="Gerando…"
            variant="secondary"
          />
        </form>
        <FormError message={resetState?.status === "error" ? resetState.error : undefined} />
        {resetState?.status === "done" && resetState.temporaryPassword && (
          <>
            <p className={darkAlertSuccess}>{resetState.message}</p>
            <TemporaryPassword username={username} password={resetState.temporaryPassword} />
          </>
        )}
      </div>
    </div>
  );
}
