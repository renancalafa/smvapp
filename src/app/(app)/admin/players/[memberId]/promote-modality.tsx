"use client";

import { useActionState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { FormError, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import type { MemberStatus, PlayerModality } from "@/generated/prisma/enums";
import {
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { promoteMemberToMonthlyAction } from "@/server/modules/members/actions";
import { MODALITY_LABEL } from "../../../labels";

const PROMOTE_DESCRIPTION =
  "A modalidade passa a Mensalista imediatamente. Inscrições já feitas, papel, estatísticas e histórico não mudam. " +
  "Se a implantação financeira já ocorreu, a promoção pode ser bloqueada pela regra de entrada de novos mensalistas.";

export function PromoteModality({
  memberId,
  username,
  modality,
  status,
}: {
  memberId: string;
  username: string;
  modality: PlayerModality;
  status: MemberStatus;
}) {
  const [state, formAction, pending] = useActionState(promoteMemberToMonthlyAction, undefined);
  const confirmSubmit = useConfirmSubmit();
  const eligible = modality === "DAILY" && status === "ACTIVE";

  return (
    <div className={`flex flex-col gap-2 ${darkCardPad}`}>
      <ActionToast
        state={state}
        successTitle="Modalidade atualizada"
        errorTitle="Falha ao promover"
      />
      <h2 className={darkTitleMd}>Modalidade</h2>
      <p className={darkMuted}>
        Modalidade atual:{" "}
        <span className="font-medium text-white">{MODALITY_LABEL[modality]}</span> ({username}).
        {status !== "ACTIVE" ? " Só diaristas ativos podem ser promovidos." : null}
      </p>
      {eligible ? (
        <form
          action={formAction}
          onSubmit={confirmSubmit({
            title: "Promover a mensalista?",
            description: PROMOTE_DESCRIPTION,
            confirmLabel: "Promover",
          })}
        >
          <input type="hidden" name="memberId" value={memberId} />
          <SubmitButton
            pending={pending}
            label="Promover a mensalista"
            pendingLabel="Promovendo…"
            variant="primary"
          />
        </form>
      ) : modality === "MONTHLY" ? (
        <p className={darkMuted}>Este jogador já é mensalista. Não há rebaixamento nesta tela.</p>
      ) : null}
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
