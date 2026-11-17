"use client";

import { useActionState } from "react";
import { CurrencyCentsField } from "@/components/currency-cents-field";
import { FormError, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertSuccess,
  darkControl,
  darkHint,
  darkLabel,
  darkMuted,
} from "@/lib/ui/dark-surfaces";
import {
  attachReceiptForm,
  declarePaymentForm,
  type PlayerPaymentFormState,
} from "@/server/modules/finance/player-actions";

export function PaymentDeclareForm({
  chargeId,
  remainingCents,
}: {
  chargeId: string;
  remainingCents: number;
}) {
  const [state, action, pending] = useActionState(
    declarePaymentForm,
    undefined as PlayerPaymentFormState,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionToast
        state={state}
        successTitle="Pagamento informado"
        errorTitle="Não foi possível informar o pagamento"
      />
      <input type="hidden" name="chargeId" value={chargeId} />
      <p className={darkMuted}>
        Informe o pagamento após transferir. O valor padrão é o saldo em aberto (
        {formatCentsBRL(remainingCents)}). Ajuste se for parcial. Comprovante é opcional.
      </p>
      <FormError message={state?.status === "error" ? state.error : undefined} />
      <CurrencyCentsField
        label="Valor pago"
        name="claimedAmountCents"
        required
        allowZero={false}
        minCents={1}
        maxCents={remainingCents}
        defaultCents={remainingCents}
        hint={`Máximo ${formatCentsBRL(remainingCents)}. A aprovação final é do administrador.`}
      />
      <label className={darkLabel}>
        Comprovante (opcional — JPEG, PNG, WebP ou PDF · máx. 10 MB)
        <input
          type="file"
          name="receipt"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className={darkControl}
        />
        <span className={darkHint}>
          Enviar arquivo não quita a cobrança nem libera a conta. Sem arquivo também fica em revisão.
        </span>
      </label>
      <SubmitButton pending={pending} label="Já fiz o pagamento" pendingLabel="Enviando…" />
    </form>
  );
}

/** Após declarar sem arquivo: anexa comprovante à mesma declaração PENDING_REVIEW. */
export function AttachReceiptForm({
  receiptId,
  claimedAmountCents,
}: {
  receiptId: string;
  claimedAmountCents: number | null;
}) {
  const [state, action, pending] = useActionState(
    attachReceiptForm,
    undefined as PlayerPaymentFormState,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionToast
        state={state}
        successTitle="Comprovante anexado"
        errorTitle="Não foi possível anexar"
      />
      <input type="hidden" name="receiptId" value={receiptId} />
      <p className={darkMuted}>
        Ainda sem arquivo
        {claimedAmountCents != null ? ` · valor informado ${formatCentsBRL(claimedAmountCents)}` : ""}
        . Anexar não altera o valor nem libera a conta.
      </p>
      <FormError message={state?.status === "error" ? state.error : undefined} />
      <label className={darkLabel}>
        Comprovante (JPEG, PNG, WebP ou PDF · máx. 10 MB)
        <input
          type="file"
          name="receipt"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
          className={darkControl}
        />
        <span className={darkHint}>Continua aguardando aprovação do administrador.</span>
      </label>
      <SubmitButton pending={pending} label="Anexar comprovante" pendingLabel="Enviando…" />
    </form>
  );
}

export function PendingDeclarationStatus({ hasReceipt }: { hasReceipt: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className={darkMuted}>Pagamento informado — aguardando aprovação do administrador.</p>
      {hasReceipt ? (
        <p className={darkAlertSuccess} role="status">
          Comprovante enviado. A liberação ocorre somente após a aprovação.
        </p>
      ) : null}
    </div>
  );
}

/** @deprecated Prefer PaymentDeclareForm */
export const ReceiptUploadForm = PaymentDeclareForm;
