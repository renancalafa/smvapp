"use client";

import { useActionState, useMemo, useState } from "react";
import { CurrencyCentsField } from "@/components/currency-cents-field";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import { timezoneDisplayLabel, timezoneSelectOptions } from "@/domain/finance/timezones";
import {
  darkAlertSuccess,
  darkCardPad,
  darkControl,
  darkHint,
  darkLabel,
  darkMuted,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  saveFinanceSettingsForm,
  setFeeExemptForm,
  overrideActivationForm,
  type FinanceFormState,
} from "@/server/modules/finance/form-actions";

const PIX_TYPES = [
  { value: "", label: "Sem PIX configurado" },
  { value: "CPF", label: "CPF" },
  { value: "CNPJ", label: "CNPJ" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "RANDOM", label: "Aleatória" },
];

export type OpenCycleActivationOption = {
  id: string;
  monthLabel: string;
  currentOpeningLabel: string;
  defaultOpeningLabel: string;
  differsFromDefault: boolean;
  dateValue: string;
  timeValue: string;
};

export type FinanceConfigDefaults = {
  dailyFeeCents: number;
  monthlyFieldCostCents: number;
  pixKey: string | null;
  pixKeyType: string | null;
  pixBeneficiaryName: string | null;
  timezone: string;
  defaultActivationHint: string;
  openCycles: OpenCycleActivationOption[];
  monthlyMembers: Array<{
    id: string;
    name: string;
    username: string;
    feeExempt: boolean;
    feeExemptReason: string | null;
    role: string;
  }>;
  auditRows: Array<{
    id: string;
    action: string;
    createdAt: string;
    summary: string;
  }>;
};

function StatusBanner({ state }: { state: FinanceFormState }) {
  if (state?.status === "saved") {
    return (
      <p className={darkAlertSuccess} role="status">
        {state.message ?? "Salvo."}
      </p>
    );
  }
  return <FormError message={state?.status === "error" ? state.error : undefined} />;
}

function ActivationChangeSection({
  cycles,
  timezone,
}: {
  cycles: OpenCycleActivationOption[];
  timezone: string;
}) {
  const [state, action, pending] = useActionState(overrideActivationForm, undefined);
  const [selectedId, setSelectedId] = useState(cycles[0]?.id ?? "");
  const selected = useMemo(
    () => cycles.find((c) => c.id === selectedId) ?? cycles[0],
    [cycles, selectedId],
  );
  const tzLabel = timezoneDisplayLabel(timezone);

  if (cycles.length === 0) {
    return (
      <div className={darkCardPad}>
        <h2 className={darkTitleMd}>Alterar início da cobrança</h2>
        <p className={darkMuted}>Não há mês aberto para alterar o início da cobrança.</p>
      </div>
    );
  }

  return (
    <form action={action} className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Alterar início da cobrança</h2>
        <p className={darkMuted}>
          Define quando a mensalidade do mês selecionado fica disponível. O padrão automático é a
          sexta-feira às 08:00 após a primeira quinta-feira regular do mês, mesmo se a sessão for
          cancelada. A alteração vale só para o mês escolhido.
        </p>
      </div>
      <StatusBanner state={state} />

      <label className={darkLabel}>
        Mês de referência
        <select
          name="cycleId"
          className={darkControl}
          value={selected?.id}
          onChange={(event) => setSelectedId(event.target.value)}
          required
        >
          {cycles.map((c) => (
            <option key={c.id} value={c.id} className="bg-smv-navy text-smv-cream">
              {c.monthLabel}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className={darkMutedXs}>Abertura atual</p>
          <p className="text-sm font-medium text-white">{selected.currentOpeningLabel}</p>
          {selected.differsFromDefault ? (
            <p className={`${darkMutedXs} mt-1`}>
              Diferente do automático ({selected.defaultOpeningLabel}).
            </p>
          ) : (
            <p className={`${darkMutedXs} mt-1`}>Igual ao cálculo automático.</p>
          )}
        </div>
      )}

      <TextField
        key={`${selected?.id}-date`}
        label="Nova data de abertura"
        name="openDate"
        type="date"
        required
        defaultValue={selected?.dateValue}
        hint="Formato do seletor: dia/mês/ano no aparelho."
      />
      <TextField
        key={`${selected?.id}-time`}
        label="Novo horário de abertura"
        name="openTime"
        type="time"
        required
        defaultValue={selected?.timeValue}
        hint={`Horário de 24 horas no fuso ${tzLabel}.`}
      />

      <label className={`${darkLabel} flex flex-row items-start gap-2`}>
        <input
          type="checkbox"
          name="confirmChange"
          value="yes"
          required
          className="mt-1 size-4 shrink-0 accent-smv-gold"
        />
        <span>
          Confirmo que esta alteração afeta apenas o mês selecionado
          {selected ? ` (${selected.monthLabel})` : ""}.
          <span className={`${darkHint} mt-1 block`}>
            Ciclos já fechados não mudam. Novos ciclos futuros continuam no cálculo automático.
          </span>
        </span>
      </label>

      <SubmitButton
        pending={pending}
        label="Salvar alteração"
        pendingLabel="Salvando…"
      />
    </form>
  );
}

export function FinanceSettingsForm({ defaults }: { defaults: FinanceConfigDefaults }) {
  const [settingsState, settingsAction, settingsPending] = useActionState(
    saveFinanceSettingsForm,
    undefined,
  );
  const [exemptState, exemptAction, exemptPending] = useActionState(setFeeExemptForm, undefined);

  const clearPix = !defaults.pixKey;

  return (
    <div className="flex flex-col gap-4">
      <form action={settingsAction} className={`flex flex-col gap-4 ${darkCardPad}`}>
        <div>
          <h2 className={darkTitleMd}>Valores e PIX</h2>
          <p className={darkMuted}>
            Mudanças não reescrevem valores já congelados. Ativação padrão:{" "}
            {defaults.defaultActivationHint}
          </p>
        </div>
        <StatusBanner state={settingsState} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CurrencyCentsField
            label="Diária"
            name="dailyFeeCents"
            defaultCents={defaults.dailyFeeCents}
            required
            allowZero={false}
            minCents={1}
            hint="Valor cobrado do diarista PRESENT."
          />
          <CurrencyCentsField
            label="Custo mensal do campo"
            name="monthlyFieldCostCents"
            defaultCents={defaults.monthlyFieldCostCents}
            required
            allowZero
            hint="Usado no cálculo da mensalidade (snapshot por ciclo)."
          />
        </div>
        <SelectField
          label="Fuso horário"
          name="timezone"
          defaultValue={defaults.timezone}
          options={timezoneSelectOptions(defaults.timezone)}
          hint="Controla horários de sessão, prazos de confirmação e o início da cobrança mensal. Não altera datas de abertura já gravadas em meses existentes."
        />
        <SelectField
          label="Tipo da chave PIX"
          name="pixKeyType"
          defaultValue={defaults.pixKeyType ?? ""}
          options={PIX_TYPES}
        />
        <TextField
          label="Chave PIX"
          name="pixKey"
          defaultValue={defaults.pixKey ?? ""}
          hint={clearPix ? "Deixe em branco junto com tipo/nome para limpar." : undefined}
        />
        <TextField
          label="Beneficiário PIX"
          name="pixBeneficiaryName"
          defaultValue={defaults.pixBeneficiaryName ?? ""}
        />
        <SubmitButton
          pending={settingsPending}
          label="Salvar financeiro"
          pendingLabel="Salvando…"
        />
      </form>

      <ActivationChangeSection cycles={defaults.openCycles} timezone={defaults.timezone} />

      <form action={exemptAction} className={`flex flex-col gap-3 ${darkCardPad}`}>
        <div>
          <h2 className={darkTitleMd}>Isenção de mensalidade</h2>
          <p className={darkMuted}>
            Sempre por membro (id estável), nunca por nome. Túlio deve ser marcado explicitamente.
            Outros ADMINs continuam pagando se não estiverem isentos.
          </p>
        </div>
        <StatusBanner state={exemptState} />
        <SelectField
          label="Mensalista"
          name="memberId"
          options={defaults.monthlyMembers.map((m) => ({
            value: m.id,
            label: `${m.name} (@${m.username})${m.feeExempt ? " · isento" : ""}${m.role === "ADMIN" ? " · ADMIN" : ""}`,
          }))}
        />
        <SelectField
          label="Isento?"
          name="feeExempt"
          defaultValue="false"
          options={[
            { value: "true", label: "Sim — isentar" },
            { value: "false", label: "Não — remover isenção" },
          ]}
        />
        <TextField label="Motivo" name="reason" required placeholder="Ex.: administrador principal" />
        <SubmitButton pending={exemptPending} label="Atualizar isenção" pendingLabel="Salvando…" />
        {defaults.monthlyMembers.some((m) => m.feeExempt) && (
          <ul className="space-y-1">
            {defaults.monthlyMembers
              .filter((m) => m.feeExempt)
              .map((m) => (
                <li key={m.id} className={darkMutedXs}>
                  Isento: {m.name} — {m.feeExemptReason ?? "sem motivo"}
                </li>
              ))}
          </ul>
        )}
      </form>

      <section className={darkCardPad}>
        <h2 className={darkTitleMd}>Histórico de auditoria (config)</h2>
        {defaults.auditRows.length === 0 ? (
          <p className={darkMuted}>Nenhuma alteração financeira recente.</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {defaults.auditRows.map((row) => (
              <li key={row.id} className="py-2">
                <p className="text-sm text-white">{row.summary}</p>
                <p className={darkMutedXs}>
                  {row.action} · {row.createdAt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
