"use client";

import { useActionState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { FormError, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import { darkBadge, darkBadgeGold, darkCardPad, darkMutedXs, darkTitleMd } from "@/lib/ui/dark-surfaces";
import { setFinanceLocksForm, type FinanceFormState } from "@/server/modules/finance/form-actions";

export function FinanceLocksToggle({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(setFinanceLocksForm, undefined as FinanceFormState);
  const confirmSubmit = useConfirmSubmit();
  return (
    <form
      action={action}
      onSubmit={confirmSubmit(
        enabled
          ? {
              title: "Desativar restrições de acesso?",
              description: "Jogadores com pendência voltam a navegar normalmente.",
              confirmLabel: "Desativar",
              tone: "danger",
            }
          : {
              title: "Ativar restrições de acesso?",
              description:
                "Jogadores com cobrança em aberto ficam limitados a Pagamentos. Administradores mantêm acesso.",
              confirmLabel: "Ativar",
            },
      )}
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${darkCardPad}`}
    >
      <ActionToast
        state={state}
        successTitle="Configuração financeira atualizada"
        errorTitle="Falha ao atualizar restrições"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={darkTitleMd}>Restrição por pendência</h2>
          <span className={enabled ? darkBadgeGold : darkBadge}>
            {enabled ? "Ativada" : "Desativada"}
          </span>
        </div>
        <p className={`mt-1 ${darkMutedXs}`}>
          Com restrição ativa, jogadores em atraso só acessam Pagamentos.
        </p>
        <FormError message={state?.status === "error" ? state.error : undefined} />
      </div>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <SubmitButton
        pending={pending}
        label={enabled ? "Desativar" : "Ativar"}
        pendingLabel="Salvando…"
        variant={enabled ? "danger" : "secondary"}
      />
    </form>
  );
}
