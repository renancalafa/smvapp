"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { CurrencyCentsField } from "@/components/currency-cents-field";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertInfo,
  darkBadge,
  darkBadgeGold,
  darkBtnGhost,
  darkCardPad,
  darkControl,
  darkInset,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  initializeFinanceForm,
  type FinanceFormState,
} from "@/server/modules/finance/form-actions";

export type InitMonthlyMember = {
  id: string;
  name: string;
  feeExempt: boolean;
};

function Banner({ state }: { state: FinanceFormState }) {
  return (
    <>
      <ActionToast
        state={state}
        successTitle="Implantação concluída"
        errorTitle="Implantação financeira"
      />
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </>
  );
}

function Section(props: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <header className="flex flex-col gap-1">
        <p className={darkSectionLabel}>Passo {props.step}</p>
        <h3 className={darkTitleMd}>{props.title}</h3>
        <p className={darkMuted}>{props.description}</p>
      </header>
      {props.children}
    </section>
  );
}

function DebtorPicker(props: {
  members: InitMonthlyMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectable = props.members.filter((m) => !m.feeExempt);
  const selected = selectable.filter((m) => props.selectedIds.includes(m.id));
  const q = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = selectable.filter((m) => {
    if (props.selectedIds.includes(m.id)) return false;
    if (!q) return true;
    return m.name.toLocaleLowerCase("pt-BR").includes(q);
  });

  function add(id: string) {
    if (props.selectedIds.includes(id)) return;
    props.onChange([...props.selectedIds, id]);
    setQuery("");
  }

  function remove(id: string) {
    props.onChange(props.selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="debtorMemberIds" value={props.selectedIds.join(",")} />
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Devedores selecionados">
          {selected.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => remove(m.id)}
                className={`${darkBadgeGold} inline-flex items-center gap-1.5 py-1.5 pl-2.5 pr-2`}
                aria-label={`Remover ${m.name}`}
              >
                <span>{m.name}</span>
                <span aria-hidden className="text-smv-gold-bright/80">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${darkInset} ${darkMutedXs}`}>
          Nenhum devedor inicial selecionado — recomendado se a cobrança regular começa só no
          próximo período (ex.: dezembro).
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
        Buscar mensalista
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Digite o nome…"
          className={darkControl}
          autoComplete="off"
        />
      </label>

      <ul
        className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/20 divide-y divide-white/8"
        role="listbox"
        aria-label="Mensalistas disponíveis"
      >
        {filtered.length === 0 ? (
          <li className={`px-3 py-3 ${darkMutedXs}`}>
            {selectable.length === selected.length
              ? "Todos os mensalistas elegíveis já foram selecionados."
              : "Nenhum nome corresponde à busca."}
          </li>
        ) : (
          filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => add(m.id)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/5"
              >
                <span>{m.name}</span>
                <span className={darkBtnGhost}>Adicionar</span>
              </button>
            </li>
          ))
        )}
      </ul>

      {props.members.some((m) => m.feeExempt) ? (
        <p className={darkMutedXs}>
          Isentos não aparecem na lista (ex.:{" "}
          {props.members
            .filter((m) => m.feeExempt)
            .map((m) => m.name)
            .join(", ")}
          ).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Onboarding da implantação financeira (única).
 * Devedores iniciais são opcionais e começam vazios — cobrança regular no próximo ciclo.
 */
export function InitializeFinanceCard(props: { monthlyMembers: InitMonthlyMember[] }) {
  const [state, action, pending] = useActionState(initializeFinanceForm, undefined);
  const confirmSubmit = useConfirmSubmit();
  const [balanceCents, setBalanceCents] = useState(0);
  const [feeCents, setFeeCents] = useState(0);
  const [fieldCents, setFieldCents] = useState(0);
  const [debtorIds, setDebtorIds] = useState<string[]>([]);
  const [reason, setReason] = useState("Implantação inicial");

  const nextPeriodPayers = props.monthlyMembers.filter((m) => !m.feeExempt);
  const exemptMembers = props.monthlyMembers.filter((m) => m.feeExempt);
  const selectedDebtors = props.monthlyMembers.filter((m) => debtorIds.includes(m.id));

  return (
    <form
      action={action}
      onSubmit={confirmSubmit({
        title: "Confirmar implantação financeira?",
        description:
          "Esta operação é única. Confirme saldo, mensalidade, campo restante e a lista opcional de dívidas iniciais.",
        confirmLabel: "Implantar agora",
        tone: "danger",
      })}
      className="flex flex-col gap-4"
    >
      <Section
        step="A"
        title="O que é esta implantação"
        description="Configuração única do caixa do grupo. Não é o ciclo mensal recorrente."
      >
        <div className={darkAlertInfo} role="note">
          <p className="font-medium text-sky-50">Começando a cobrar só em dezembro?</p>
          <p className="mt-1 text-sm text-sky-100/90">
            Deixe a lista de devedores iniciais vazia. A implantação registra o saldo e os
            parâmetros; as mensalidades regulares de todos os mensalistas ativos (exceto isentos)
            serão geradas no próximo período de cobrança.
          </p>
        </div>
        <Banner state={state} />
      </Section>

      <Section
        step="B"
        title="Valores iniciais"
        description="Informe a situação real do caixa no momento da virada para o SMV."
      >
        <CurrencyCentsField
          label="Saldo de caixa atual"
          name="initialBalanceCents"
          defaultCents={0}
          required
          allowZero
          hint="Dinheiro já disponível (não é receita futura)."
          onCentsChange={(c) => setBalanceCents(c ?? 0)}
        />
        <CurrencyCentsField
          label="Mensalidade de referência"
          name="openingMonthlyFeeCents"
          defaultCents={0}
          required
          allowZero
          hint="Valor usado no mês corrente / referência da abertura. Não gera cobrança automática para todos."
          onCentsChange={(c) => setFeeCents(c ?? 0)}
        />
        <CurrencyCentsField
          label="Quadra ainda a pagar neste mês"
          name="remainingFieldCostCents"
          defaultCents={0}
          required
          allowZero
          hint="Saldo do aluguel da quadra que ainda falta pagar."
          onCentsChange={(c) => setFieldCents(c ?? 0)}
        />
      </Section>

      <Section
        step="C"
        title="Dívidas iniciais (opcional)"
        description="Só marque quem já deve a mensalidade do período atual. Padrão: ninguém."
      >
        <DebtorPicker
          members={props.monthlyMembers}
          selectedIds={debtorIds}
          onChange={setDebtorIds}
        />
      </Section>

      <Section
        step="D"
        title="Prévia"
        description="Resumo do que será gravado agora e do que fica para o próximo período."
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={darkInset}>
            <dt className={darkMutedXs}>Saldo de abertura</dt>
            <dd className="mt-1 text-base font-semibold text-smv-gold-bright">
              {formatCentsBRL(balanceCents)}
            </dd>
          </div>
          <div className={darkInset}>
            <dt className={darkMutedXs}>Mensalidade de referência</dt>
            <dd className="mt-1 text-base font-semibold text-white">{formatCentsBRL(feeCents)}</dd>
          </div>
          <div className={darkInset}>
            <dt className={darkMutedXs}>Quadra ainda a pagar</dt>
            <dd className="mt-1 text-base font-semibold text-white">{formatCentsBRL(fieldCents)}</dd>
          </div>
          <div className={darkInset}>
            <dt className={darkMutedXs}>Devedores iniciais agora</dt>
            <dd className="mt-1 text-base font-semibold text-white">
              {selectedDebtors.length}
              {selectedDebtors.length > 0 ? (
                <span className={`mt-1 block font-normal ${darkMutedXs}`}>
                  {selectedDebtors.map((m) => m.name).join(", ")}
                </span>
              ) : (
                <span className={`mt-1 block font-normal ${darkMutedXs}`}>
                  Nenhuma cobrança de abertura será criada
                </span>
              )}
            </dd>
          </div>
          <div className={darkInset}>
            <dt className={darkMutedXs}>Mensalistas no próximo período</dt>
            <dd className="mt-1 text-base font-semibold text-white">
              {nextPeriodPayers.length}
              <span className={`mt-1 block font-normal ${darkMutedXs}`}>
                Cobrança regular na próxima ativação do ciclo (ativos não isentos)
              </span>
            </dd>
          </div>
          <div className={darkInset}>
            <dt className={darkMutedXs}>Isentos</dt>
            <dd className="mt-1 text-base font-semibold text-white">
              {exemptMembers.length === 0 ? (
                "Nenhum"
              ) : (
                <>
                  {exemptMembers.length}
                  <span className={`mt-1 block font-normal ${darkMutedXs}`}>
                    {exemptMembers.map((m) => m.name).join(", ")}
                    {exemptMembers.some((m) => /túlio|tulio/i.test(m.name))
                      ? " · permanece isento via feeExempt"
                      : ""}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
        {selectedDebtors.length > 0 && feeCents > 0 ? (
          <p className={darkMutedXs}>
            Total estimado das dívidas iniciais:{" "}
            <span className="font-medium text-white">
              {formatCentsBRL(selectedDebtors.length * feeCents)}
            </span>
          </p>
        ) : null}
      </Section>

      <Section
        step="E"
        title="Confirmação"
        description="Revise a prévia. A implantação não pode ser desfeita pelo fluxo normal."
      >
        <TextField
          label="Motivo (obrigatório)"
          name="reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Ex.: Virada para cobrança SMV a partir de dezembro."
        />
        <ul className={`flex flex-wrap gap-2 ${darkMutedXs}`}>
          <li className={darkBadge}>Operação única</li>
          <li className={darkBadge}>Devedores opcionais</li>
          <li className={darkBadge}>Próximo ciclo gera mensalidades</li>
        </ul>
        <SubmitButton
          pending={pending}
          label="Implantar financeiro"
          pendingLabel="Implantando…"
        />
      </Section>
    </form>
  );
}
