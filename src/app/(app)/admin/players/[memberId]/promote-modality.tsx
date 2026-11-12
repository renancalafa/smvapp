"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SubmitButton } from "@/components/form-fields";
import type { MemberStatus, PlayerModality } from "@/generated/prisma/enums";
import {
  darkAlertSuccess,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { promoteMemberToMonthlyAction } from "@/server/modules/members/actions";
import { MODALITY_LABEL } from "../../../labels";

const PROMOTE_CONFIRM =
  "Promover este diarista a MENSALISTA?\n\n" +
  "O que muda:\n" +
  "• A modalidade passa a Mensalista imediatamente na ficha e nas listas.\n" +
  "• Nas próximas confirmações de presença, vale a prioridade de mensalista.\n\n" +
  "O que NÃO muda:\n" +
  "• Inscrições já feitas (participante/espera), snapshots de modalidade e fila das sessões atuais.\n" +
  "• Papel, isenção financeira, estatísticas, pagamentos e histórico.\n" +
  "• Ninguém é deslocado automaticamente de uma sessão em andamento.\n\n" +
  "Cobranças: se a implantação financeira já ocorreu, a promoção pode ser bloqueada pela mesma regra de entrada de novos mensalistas (módulo de cobranças).";

function confirmSubmit(message: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(message)) event.preventDefault();
  };
}

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
  const eligible = modality === "DAILY" && status === "ACTIVE";

  return (
    <div className={`flex flex-col gap-2 ${darkCardPad}`}>
      <h2 className={darkTitleMd}>Modalidade</h2>
      <p className={darkMuted}>
        Modalidade atual:{" "}
        <span className="font-medium text-white">{MODALITY_LABEL[modality]}</span> ({username}).
        {status !== "ACTIVE" ? " Só diaristas ativos podem ser promovidos." : null}
      </p>
      {eligible ? (
        <form action={formAction} onSubmit={confirmSubmit(PROMOTE_CONFIRM)}>
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
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
