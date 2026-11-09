"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { updateAgendaSettingsAction } from "@/server/modules/group-settings/actions";
import { minuteOfDayToTime } from "@/server/modules/group-settings/validation";

const WEEKDAY_LABEL: Record<string, string> = {
  MONDAY: "segunda-feira",
  TUESDAY: "terça-feira",
  WEDNESDAY: "quarta-feira",
  THURSDAY: "quinta-feira",
  FRIDAY: "sexta-feira",
  SATURDAY: "sábado",
  SUNDAY: "domingo",
};

export type AgendaFormDefaults = {
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
  sessionWeekday: string;
  sessionStartLabel: string;
  timeZone: string;
};

export function AgendaForm({ defaults }: { defaults: AgendaFormDefaults }) {
  const [state, formAction, pending] = useActionState(updateAgendaSettingsAction, undefined);
  const values = state?.status === "error" ? state.values : undefined;
  const weekdayLabel = WEEKDAY_LABEL[defaults.sessionWeekday] ?? defaults.sessionWeekday;

  return (
    <form action={formAction} className={`flex flex-col gap-4 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Confirmação semanal</h2>
        <p className={darkMuted}>
          Sessão em {weekdayLabel} às {defaults.sessionStartLabel} ({defaults.timeZone}). Dias são contados
          antes desse dia. Sessões já criadas mantêm os horários gravados.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Abertura da lista</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Dias antes"
            name="registrationOpensDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={values?.registrationOpensDaysBefore ?? String(defaults.registrationOpensDaysBefore)}
            hint="Ex.: 3 = segunda para pelada na quinta."
          />
          <TextField
            label="Horário"
            name="registrationOpensTime"
            type="time"
            required
            defaultValue={values?.registrationOpensTime ?? minuteOfDayToTime(defaults.registrationOpensMinute)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Prazo dos mensalistas</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Dias antes"
            name="priorityDeadlineDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={values?.priorityDeadlineDaysBefore ?? String(defaults.priorityDeadlineDaysBefore)}
            hint="Ex.: 0 = no próprio dia da sessão."
          />
          <TextField
            label="Horário"
            name="priorityDeadlineTime"
            type="time"
            required
            defaultValue={values?.priorityDeadlineTime ?? minuteOfDayToTime(defaults.priorityDeadlineMinute)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Lembrete do prazo</legend>
        <SelectField
          label="Lembrete"
          name="priorityReminderEnabled"
          defaultValue={
            values?.priorityReminderEnabled ?? (defaults.priorityReminderEnabled ? "true" : "false")
          }
          options={[
            { value: "true", label: "Ativado" },
            { value: "false", label: "Desativado" },
          ]}
          hint="Notifica mensalistas ativos que ainda não responderam. Horário depois da abertura e antes do prazo."
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Dias antes"
            name="priorityReminderDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={values?.priorityReminderDaysBefore ?? String(defaults.priorityReminderDaysBefore)}
          />
          <TextField
            label="Horário"
            name="priorityReminderTime"
            type="time"
            required
            defaultValue={values?.priorityReminderTime ?? minuteOfDayToTime(defaults.priorityReminderMinute)}
          />
        </div>
      </fieldset>

      {state?.status === "saved" && <p className={darkAlertSuccess}>Agenda salva.</p>}
      <FormError message={state?.status === "error" ? state.error : undefined} />
      <SubmitButton pending={pending} label="Salvar agenda" pendingLabel="Salvando…" />
    </form>
  );
}
