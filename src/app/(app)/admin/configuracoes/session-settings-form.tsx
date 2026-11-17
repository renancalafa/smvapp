"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { updateSessionFormatAction } from "@/server/modules/group-settings/session-actions";
import { minuteOfDayToTime } from "@/server/modules/group-settings/validation";

const WEEKDAY_OPTIONS = [
  { value: "MONDAY", label: "Segunda" },
  { value: "TUESDAY", label: "Terça" },
  { value: "WEDNESDAY", label: "Quarta" },
  { value: "THURSDAY", label: "Quinta" },
  { value: "FRIDAY", label: "Sexta" },
  { value: "SATURDAY", label: "Sábado" },
  { value: "SUNDAY", label: "Domingo" },
];

export type SessionSettingsDefaults = {
  sessionWeekday: string;
  sessionStartMinute: number;
  sessionEndMinute: number;
  maxExtraMinutes: number;
  maxPlayers: number;
  teamSize: number;
  matchDurationSec: number;
  drawOptionsCount: number;
  drawMinOptionDifference: number;
  sessionAutoCreateLeadDays: number;
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
  timeZone: string;
};

export function SessionSettingsForm({ defaults }: { defaults: SessionSettingsDefaults }) {
  const [state, formAction, pending] = useActionState(updateSessionFormatAction, undefined);

  return (
    <form action={formAction} className={`flex flex-col gap-4 ${darkCardPad}`}>
      <div>
        <h2 className={darkTitleMd}>Sessão regular</h2>
        <p className={darkMuted}>
          Alterações valem para sessões futuras. Sessões já criadas ou finalizadas mantêm o snapshot
          gravado. Fuso horário atual: {defaults.timeZone} (editável em Financeiro).
        </p>
      </div>

      {state?.status === "saved" && (
        <p className={darkAlertSuccess} role="status">
          Configurações de sessão salvas.
        </p>
      )}
      <FormError message={state?.status === "error" ? state.error : undefined} />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Dia e horário</legend>
        <SelectField
          label="Dia da semana"
          name="sessionWeekday"
          defaultValue={defaults.sessionWeekday}
          options={WEEKDAY_OPTIONS}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Início"
            name="sessionStartTime"
            type="time"
            required
            defaultValue={minuteOfDayToTime(defaults.sessionStartMinute)}
          />
          <TextField
            label="Término"
            name="sessionEndTime"
            type="time"
            required
            defaultValue={minuteOfDayToTime(defaults.sessionEndMinute)}
          />
        </div>
        <TextField
          label="Tempo extra máximo (min)"
          name="maxExtraMinutes"
          type="number"
          min={0}
          max={30}
          required
          defaultValue={String(defaults.maxExtraMinutes)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Capacidade e partida</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Máx. jogadores"
            name="maxPlayers"
            type="number"
            min={1}
            max={40}
            required
            defaultValue={String(defaults.maxPlayers)}
          />
          <TextField
            label="Jogadores por time"
            name="teamSize"
            type="number"
            min={1}
            max={20}
            required
            defaultValue={String(defaults.teamSize)}
          />
        </div>
        <TextField
          label="Duração da partida (segundos)"
          name="matchDurationSec"
          type="number"
          min={60}
          max={3600}
          required
          defaultValue={String(defaults.matchDurationSec)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Sorteio</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Opções geradas"
            name="drawOptionsCount"
            type="number"
            min={1}
            max={5}
            required
            defaultValue={String(defaults.drawOptionsCount)}
          />
          <TextField
            label="Diferença mín. entre opções"
            name="drawMinOptionDifference"
            type="number"
            min={0}
            max={50}
            required
            defaultValue={String(defaults.drawMinOptionDifference)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-white">Confirmação semanal</legend>
        <TextField
          label="Antecedência criação auto (dias)"
          name="sessionAutoCreateLeadDays"
          type="number"
          min={0}
          max={28}
          required
          defaultValue={String(defaults.sessionAutoCreateLeadDays)}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Abertura — dias antes"
            name="registrationOpensDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={String(defaults.registrationOpensDaysBefore)}
          />
          <TextField
            label="Abertura — horário"
            name="registrationOpensTime"
            type="time"
            required
            defaultValue={minuteOfDayToTime(defaults.registrationOpensMinute)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Prazo mensalistas — dias"
            name="priorityDeadlineDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={String(defaults.priorityDeadlineDaysBefore)}
          />
          <TextField
            label="Prazo — horário"
            name="priorityDeadlineTime"
            type="time"
            required
            defaultValue={minuteOfDayToTime(defaults.priorityDeadlineMinute)}
          />
        </div>
        <SelectField
          label="Lembrete"
          name="priorityReminderEnabled"
          defaultValue={defaults.priorityReminderEnabled ? "true" : "false"}
          options={[
            { value: "true", label: "Ativado" },
            { value: "false", label: "Desativado" },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Lembrete — dias"
            name="priorityReminderDaysBefore"
            type="number"
            min={0}
            max={28}
            required
            defaultValue={String(defaults.priorityReminderDaysBefore)}
          />
          <TextField
            label="Lembrete — horário"
            name="priorityReminderTime"
            type="time"
            required
            defaultValue={minuteOfDayToTime(defaults.priorityReminderMinute)}
          />
        </div>
      </fieldset>

      <SubmitButton pending={pending} label="Salvar sessão" pendingLabel="Salvando…" />
    </form>
  );
}
