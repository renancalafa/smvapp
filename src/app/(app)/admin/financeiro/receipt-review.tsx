"use client";

import { useActionState, useId, useState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { CurrencyCentsField } from "@/components/currency-cents-field";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import { datetimeLocalValueInZone } from "@/domain/finance/cycleDates";
import { isDeclarationWithoutReceipt } from "@/domain/finance/receiptUpload";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertWarn,
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkLinkCard,
  darkMuted,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  approveReceiptForm,
  rejectReceiptForm,
  grantAccessForm,
  type FinanceFormState,
} from "@/server/modules/finance/form-actions";

function Banner({
  state,
  successTitle,
}: {
  state: FinanceFormState;
  successTitle: string;
}) {
  return (
    <>
      <ActionToast state={state} successTitle={successTitle} errorTitle="Operação financeira" />
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </>
  );
}

export type ReceiptQueueItem = {
  id: string;
  createdAt: string;
  mimeType: string;
  byteSize: number;
  storageKey?: string;
  claimedAmountCents: number | null;
  playerName: string;
  playerUsername: string;
  memberId: string;
  chargeId: string;
  chargeType: string;
  chargeAmountCents: number;
  remainingCents: number;
  periodLabel: string;
};

export function ReceiptReviewQueue({
  items,
  timeZone,
}: {
  items: ReceiptQueueItem[];
  timeZone: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <section className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkTitleMd}>Pagamentos a revisar</h2>
        <p className={darkMuted}>Nenhum pagamento informado aguardando confirmação.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className={darkTitleMd}>Pagamentos a revisar</h2>
        <span className={darkMutedXs}>
          {items.length} {items.length === 1 ? "pendente" : "pendentes"}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const open = expandedId === item.id;
          return (
            <li key={item.id}>
              <ReceiptReviewAccordionItem
                item={item}
                open={open}
                timeZone={timeZone}
                onToggle={() => setExpandedId(open ? null : item.id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReceiptReviewAccordionItem({
  item,
  open,
  onToggle,
  timeZone,
}: {
  item: ReceiptQueueItem;
  open: boolean;
  onToggle: () => void;
  timeZone: string;
}) {
  const panelId = useId();
  const withoutReceipt = isDeclarationWithoutReceipt(item);
  const declared = item.claimedAmountCents ?? item.remainingCents;
  const chargeKind = item.chargeType === "MONTHLY_FEE" ? "Mensalidade" : "Diária";

  return (
    <article
      className={`overflow-hidden rounded-2xl border ring-1 ${
        withoutReceipt
          ? "border-amber-300/35 bg-smv-navy-card ring-amber-300/15"
          : "border-white/12 bg-smv-navy-card ring-white/8"
      }`}
    >
      <button
        type="button"
        className="flex w-full min-h-14 items-center gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-smv-gold"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-smv-cream">{item.playerName}</p>
            <span className={withoutReceipt ? darkBadgeGold : darkBadge}>
              {withoutReceipt ? "Sem comprovante" : "Com comprovante"}
            </span>
          </div>
          <p className={`${darkMutedXs} mt-0.5 truncate`}>
            {formatCentsBRL(declared)} · {chargeKind} · {item.periodLabel} · {item.createdAt}
          </p>
        </div>
        <span
          className={`shrink-0 text-sm font-medium text-smv-gold transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="border-t border-white/10 px-3 pb-3 pt-3"
          role="region"
          aria-label={`Revisar pagamento de ${item.playerName}`}
        >
          <ReceiptReviewExpanded
            item={item}
            withoutReceipt={withoutReceipt}
            timeZone={timeZone}
          />
        </div>
      ) : null}
    </article>
  );
}

function ReceiptReviewExpanded({
  item,
  withoutReceipt,
  timeZone,
}: {
  item: ReceiptQueueItem;
  withoutReceipt: boolean;
  timeZone: string;
}) {
  const [approveState, approveAction, approvePending] = useActionState(approveReceiptForm, undefined);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectReceiptForm, undefined);
  const [grantState, grantAction, grantPending] = useActionState(grantAccessForm, undefined);
  const [showGrant, setShowGrant] = useState(false);
  // Remonta o painel ao abrir → horário fresco no fuso do grupo (não UTC via toISOString).
  const [paidAtLocal, setPaidAtLocal] = useState(() =>
    datetimeLocalValueInZone(new Date(), timeZone),
  );
  const confirmSubmit = useConfirmSubmit();
  const defaultAmount = item.claimedAmountCents ?? item.remainingCents;
  const chargeKind = item.chargeType === "MONTHLY_FEE" ? "Mensalidade" : "Diária";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-white">
          @{item.playerUsername} · {chargeKind} · {item.periodLabel}
        </p>
        <p className={darkMutedXs}>
          Declarado {item.claimedAmountCents != null ? formatCentsBRL(item.claimedAmountCents) : "—"}{" "}
          · em aberto {formatCentsBRL(item.remainingCents)} de{" "}
          {formatCentsBRL(item.chargeAmountCents)}
        </p>
        {withoutReceipt ? (
          <p className={`mt-1 ${darkAlertWarn}`}>
            Sem comprovante anexado. Confirme no extrato/PIX antes de aprovar.
          </p>
        ) : (
          <a
            href={`/api/finance/receipts/${item.id}`}
            target="_blank"
            rel="noreferrer"
            className={`${darkLinkCard} mt-1 inline-flex`}
          >
            Abrir comprovante
          </a>
        )}
      </div>

      <form action={approveAction} className="flex flex-col gap-2">
        <Banner state={approveState} successTitle="Pagamento aprovado" />
        <input type="hidden" name="receiptId" value={item.id} />
        <CurrencyCentsField
          label="Valor a confirmar"
          name="amountCents"
          allowEmpty
          allowZero={false}
          maxCents={item.remainingCents}
          defaultCents={defaultAmount}
          hint="Vazio quita o saldo restante. Parcial: informe valor menor."
        />
        <TextField
          label="Data do pagamento"
          name="paidAt"
          type="datetime-local"
          value={paidAtLocal}
          onChange={(e) => setPaidAtLocal(e.target.value)}
          hint="Horário no fuso do grupo. Datas históricas ok; futuro é rejeitado."
          required
        />
        <TextField label="Observação (opcional)" name="notes" />
        <SubmitButton
          pending={approvePending}
          label="Aprovar pagamento"
          pendingLabel="Aprovando…"
        />
      </form>

      <form
        action={rejectAction}
        onSubmit={confirmSubmit({
          title: "Rejeitar declaração?",
          description: "O jogador poderá informar o pagamento novamente.",
          confirmLabel: "Rejeitar",
          tone: "danger",
        })}
        className="flex flex-col gap-2 border-t border-white/10 pt-3"
      >
        <Banner state={rejectState} successTitle="Declaração rejeitada" />
        <input type="hidden" name="receiptId" value={item.id} />
        <TextField label="Motivo da rejeição" name="reason" required />
        <SubmitButton
          pending={rejectPending}
          label="Rejeitar"
          pendingLabel="Rejeitando…"
          variant="danger"
        />
      </form>

      <div className="border-t border-white/10 pt-3">
        <button
          type="button"
          className="text-sm font-medium text-smv-gold underline-offset-2 hover:underline"
          onClick={() => setShowGrant((v) => !v)}
          aria-expanded={showGrant}
        >
          {showGrant ? "Ocultar liberação excepcional" : "Liberar acesso excepcionalmente…"}
        </button>
        {showGrant ? (
          <form
            action={grantAction}
            onSubmit={confirmSubmit({
              title: "Liberar acesso excepcionalmente?",
              description: "O jogador volta a usar o SMV enquanto a dívida permanece.",
              confirmLabel: "Liberar acesso",
            })}
            className="mt-3 flex flex-col gap-2"
          >
            <Banner state={grantState} successTitle="Acesso liberado" />
            <input type="hidden" name="memberId" value={item.memberId} />
            <input type="hidden" name="relatedChargeId" value={item.chargeId} />
            <TextField
              label="Motivo"
              name="reason"
              required
              placeholder="Ex.: combinado verbal até a próxima quinta"
            />
            <SubmitButton
              pending={grantPending}
              label="Liberar acesso"
              pendingLabel="Liberando…"
              variant="secondary"
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
