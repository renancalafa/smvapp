"use client";

import { useActionState, useState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { CurrencyCentsField } from "@/components/currency-cents-field";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import { formatCentsBRL } from "@/lib/money";
import {
  darkCardPad,
  darkMuted,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  approveCreditForm,
  confirmPaymentForm,
  freezeCycleForm,
  recordAdjustmentForm,
  recordFieldCostForm,
  recordOtherExpenseForm,
  reverseCashForm,
  type FinanceFormState,
} from "@/server/modules/finance/form-actions";

function Banner({
  state,
  successTitle = "Salvo",
}: {
  state: FinanceFormState;
  successTitle?: string;
}) {
  return (
    <>
      <ActionToast state={state} successTitle={successTitle} errorTitle="Operação financeira" />
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </>
  );
}

function nowLocalDatetime(): string {
  return new Date().toISOString().slice(0, 16);
}

const OP_OPTIONS = [
  { id: "receive", label: "Receber pagamento" },
  { id: "field", label: "Pagar quadra" },
  { id: "other", label: "Outra despesa" },
  { id: "adjust", label: "Ajuste de caixa" },
] as const;

type MovementOp = (typeof OP_OPTIONS)[number]["id"];

export function CreditApprovalCard(props: {
  cycleId: string;
  availableCents: number;
  approvedCreditCents: number;
  priorUnallocatedCents: number;
  dailyEligibleCents: number;
  forecastMonthlyFeeCents: number | null;
  fieldCostCents: number;
  payingCount: number;
  freezesAtLabel: string;
}) {
  const [state, action, pending] = useActionState(approveCreditForm, undefined);
  return (
    <form action={action} className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Crédito do ciclo</h2>
        <p className={darkMuted}>Corte {props.freezesAtLabel}. Só entra no cálculo se aprovado.</p>
      </div>
      <Banner state={state} successTitle="Crédito atualizado" />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className={darkMutedXs}>Custo do campo (snapshot)</dt>
          <dd className="font-semibold text-white">{formatCentsBRL(props.fieldCostCents)}</dd>
        </div>
        <div>
          <dt className={darkMutedXs}>Mensalistas pagantes</dt>
          <dd className="font-semibold text-white">{props.payingCount}</dd>
        </div>
        <div>
          <dt className={darkMutedXs}>Diárias elegíveis</dt>
          <dd className="font-semibold text-white">{formatCentsBRL(props.dailyEligibleCents)}</dd>
        </div>
        <div>
          <dt className={darkMutedXs}>Sobra anterior</dt>
          <dd className="font-semibold text-white">{formatCentsBRL(props.priorUnallocatedCents)}</dd>
        </div>
        <div>
          <dt className={darkMutedXs}>Disponível para crédito</dt>
          <dd className="font-semibold text-smv-gold-bright">{formatCentsBRL(props.availableCents)}</dd>
        </div>
        <div>
          <dt className={darkMutedXs}>Crédito aprovado</dt>
          <dd className="font-semibold text-white">{formatCentsBRL(props.approvedCreditCents)}</dd>
        </div>
        <div className="col-span-2">
          <dt className={darkMutedXs}>Mensalidade estimada / jogador</dt>
          <dd className="text-lg font-semibold text-white">
            {props.forecastMonthlyFeeCents == null
              ? "—"
              : formatCentsBRL(props.forecastMonthlyFeeCents)}
          </dd>
        </div>
      </dl>
      <input type="hidden" name="targetCycleId" value={props.cycleId} />
      <CurrencyCentsField
        label="Aprovar crédito"
        name="amountCents"
        defaultCents={props.approvedCreditCents}
        required
        allowZero
        maxCents={props.availableCents}
        hint={`Máximo ${formatCentsBRL(props.availableCents)}. Use R$ 0,00 para nenhum crédito.`}
      />
      <TextField label="Observação" name="notes" placeholder="Opcional" />
      <SubmitButton pending={pending} label="Aprovar crédito" pendingLabel="Salvando…" />
    </form>
  );
}

function ReceivePaymentForm({
  charges,
}: {
  charges: Array<{ id: string; label: string; remainingCents: number }>;
}) {
  const [state, action, pending] = useActionState(confirmPaymentForm, undefined);
  if (charges.length === 0) {
    return <p className={darkMuted}>Nenhuma cobrança em aberto para receber.</p>;
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className={darkMutedXs}>Confirma entrada no caixa e reduz o saldo da cobrança.</p>
      <Banner state={state} successTitle="Pagamento confirmado" />
      <SelectField
        label="Cobrança"
        name="chargeId"
        options={charges.map((c) => ({
          value: c.id,
          label: `${c.label} · aberto ${formatCentsBRL(c.remainingCents)}`,
        }))}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CurrencyCentsField
          label="Valor"
          name="amountCents"
          allowEmpty
          allowZero={false}
          minCents={1}
          hint="Vazio quita o restante. Parcial: valor menor que o saldo."
        />
        <SelectField
          label="Método"
          name="method"
          defaultValue="PIX"
          options={[
            { value: "PIX", label: "PIX" },
            { value: "CASH", label: "Dinheiro" },
            { value: "BANK_TRANSFER", label: "Transferência" },
            { value: "OTHER", label: "Outro" },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Data do pagamento"
          name="paidAt"
          type="datetime-local"
          defaultValue={nowLocalDatetime()}
          required
        />
        <TextField label="Observação (opcional)" name="notes" />
      </div>
      <SubmitButton pending={pending} label="Confirmar recebimento" pendingLabel="Confirmando…" />
    </form>
  );
}

function FieldCostForm({
  cycleOptions,
}: {
  cycleOptions: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(recordFieldCostForm, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className={darkMutedXs}>
        Saída de caixa pela quadra. Não altera o custo usado no cálculo da mensalidade.
      </p>
      <Banner state={state} successTitle="Pagamento da quadra registrado" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="Ciclo" name="billingCycleId" options={cycleOptions} />
        <CurrencyCentsField
          label="Valor"
          name="amountCents"
          required
          allowZero={false}
          minCents={1}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Data"
          name="occurredAt"
          type="datetime-local"
          defaultValue={nowLocalDatetime()}
          required
        />
        <TextField label="Observação (opcional)" name="notes" />
      </div>
      <SubmitButton pending={pending} label="Registrar pagamento da quadra" pendingLabel="Salvando…" />
    </form>
  );
}

function OtherExpenseForm({
  cycleOptions,
}: {
  cycleOptions: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(recordOtherExpenseForm, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className={darkMutedXs}>Despesa avulsa com motivo obrigatório.</p>
      <Banner state={state} successTitle="Despesa registrada" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="Ciclo" name="billingCycleId" options={cycleOptions} />
        <CurrencyCentsField
          label="Valor"
          name="amountCents"
          required
          allowZero={false}
          minCents={1}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Motivo" name="reason" required />
        <TextField
          label="Data"
          name="occurredAt"
          type="datetime-local"
          defaultValue={nowLocalDatetime()}
          required
        />
      </div>
      <SubmitButton pending={pending} label="Registrar despesa" pendingLabel="Salvando…" />
    </form>
  );
}

function AdjustmentForm({
  cycleOptions,
}: {
  cycleOptions: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(recordAdjustmentForm, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className={darkMutedXs}>Correção manual de entrada ou saída, com motivo.</p>
      <Banner state={state} successTitle="Ajuste registrado" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="Ciclo" name="billingCycleId" options={cycleOptions} />
        <SelectField
          label="Tipo"
          name="direction"
          options={[
            { value: "IN", label: "Entrada" },
            { value: "OUT", label: "Saída" },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CurrencyCentsField
          label="Valor"
          name="amountCents"
          required
          allowZero={false}
          minCents={1}
        />
        <TextField label="Motivo" name="reason" required />
      </div>
      <SubmitButton pending={pending} label="Registrar ajuste" pendingLabel="Salvando…" />
    </form>
  );
}

function ReverseCashForm() {
  const [state, action, pending] = useActionState(reverseCashForm, undefined);
  const confirmSubmit = useConfirmSubmit();
  return (
    <form
      action={action}
      onSubmit={confirmSubmit({
        title: "Estornar lançamento?",
        description: "Esta ação é irreversível no caixa. Informe o motivo no formulário.",
        confirmLabel: "Estornar",
        tone: "danger",
      })}
      className="flex flex-col gap-3 border-t border-white/10 pt-3"
    >
      <p className={darkMutedXs}>Estorno excepcional de um lançamento já registrado.</p>
      <Banner state={state} successTitle="Estorno registrado" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="ID do lançamento" name="cashTransactionId" required />
        <TextField label="Motivo" name="reason" required />
      </div>
      <SubmitButton pending={pending} label="Estornar" pendingLabel="Estornando…" variant="danger" />
    </form>
  );
}

/** Seletor compacto: receber / quadra / despesa / ajuste (+ estorno avançado). */
export function FinancialMovementsPanel(props: {
  charges: Array<{ id: string; label: string; remainingCents: number }>;
  cycleOptions: Array<{ value: string; label: string }>;
}) {
  const [op, setOp] = useState<MovementOp>("receive");
  const [showReverse, setShowReverse] = useState(false);
  const hasCycles = props.cycleOptions.length > 0;

  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Movimentações financeiras</h2>
        <p className={darkMutedXs}>Escolha a operação. Só o formulário selecionado fica visível.</p>
      </div>

      <div
        role="tablist"
        aria-label="Tipo de movimentação"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {OP_OPTIONS.map((option) => {
          const selected = op === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setOp(option.id)}
              className={`min-h-11 rounded-xl border px-2 py-2 text-center text-xs font-semibold sm:text-sm ${
                selected
                  ? "border-smv-gold/50 bg-smv-gold/15 text-smv-gold-bright"
                  : "border-white/15 bg-black/20 text-white/75 hover:bg-white/8"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="pt-1">
        {op === "receive" ? <ReceivePaymentForm charges={props.charges} /> : null}
        {op === "field" ? (
          hasCycles ? (
            <FieldCostForm cycleOptions={props.cycleOptions} />
          ) : (
            <p className={darkMuted}>Implante o financeiro ou aguarde ciclos para pagar a quadra.</p>
          )
        ) : null}
        {op === "other" ? (
          hasCycles ? (
            <OtherExpenseForm cycleOptions={props.cycleOptions} />
          ) : (
            <p className={darkMuted}>Implante o financeiro ou aguarde ciclos para registrar despesas.</p>
          )
        ) : null}
        {op === "adjust" ? (
          hasCycles ? (
            <AdjustmentForm cycleOptions={props.cycleOptions} />
          ) : (
            <p className={darkMuted}>Implante o financeiro ou aguarde ciclos para ajustar o caixa.</p>
          )
        ) : null}
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium text-smv-gold underline-offset-2 hover:underline"
          aria-expanded={showReverse}
          onClick={() => setShowReverse((v) => !v)}
        >
          {showReverse ? "Ocultar estorno" : "Estornar lançamento…"}
        </button>
        {showReverse ? <ReverseCashForm /> : null}
      </div>
    </section>
  );
}

/** @deprecated Prefer FinancialMovementsPanel */
export function RecordPaymentCard(props: {
  charges: Array<{ id: string; label: string; remainingCents: number }>;
}) {
  return <FinancialMovementsPanel charges={props.charges} cycleOptions={[]} />;
}

/** @deprecated Prefer FinancialMovementsPanel */
export function ExpenseCards(props: {
  cycleOptions: Array<{ value: string; label: string }>;
}) {
  return <FinancialMovementsPanel charges={[]} cycleOptions={props.cycleOptions} />;
}

export function FreezeCycleCard({ cycleId, label }: { cycleId: string; label: string }) {
  const [state, action, pending] = useActionState(freezeCycleForm, undefined);
  const confirmSubmit = useConfirmSubmit();
  return (
    <form
      action={action}
      onSubmit={confirmSubmit({
        title: "Congelar ciclo agora?",
        description: `Fallback manual para o ciclo ${label}. Idempotente se o corte já ocorreu.`,
        confirmLabel: "Congelar",
        tone: "danger",
      })}
      className={`flex flex-col gap-3 ${darkCardPad}`}
    >
      <h2 className={darkTitleMd}>Congelar ciclo</h2>
      <p className={darkMuted}>
        Fallback manual se o corte já passou. Idempotente. Ciclo: {label}
      </p>
      <Banner state={state} successTitle="Ciclo congelado" />
      <input type="hidden" name="cycleId" value={cycleId} />
      <SubmitButton pending={pending} label="Congelar agora" pendingLabel="Congelando…" variant="danger" />
    </form>
  );
}

