"use client";

import { useActionState, useState } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkBody,
  darkBtnGhost,
  darkBtnSecondary,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { createExtraordinarySessionAction } from "@/server/modules/sessions/actions";
import { DEFAULT_EXTRAORDINARY_VENUE } from "@/server/modules/sessions/extraordinary-input";

function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function nowMinuteInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export function CreateExtraordinaryForm({
  timeZone,
  defaultMaxPlayers,
}: {
  timeZone: string;
  defaultMaxPlayers: number;
}) {
  const [state, formAction, pending] = useActionState(createExtraordinarySessionAction, undefined);
  const [open, setOpen] = useState(false);
  const [registrationMode, setRegistrationMode] = useState("immediate");
  const values = state?.status === "error" ? state.values : undefined;
  const defaultDate = todayInZone(timeZone);
  const defaultPriorityTime = nowMinuteInZone(timeZone);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`w-full ${darkBtnSecondary}`}>
        Criar sessão extraordinária
      </button>
    );
  }

  return (
    <form action={formAction} className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className={darkTitleMd}>Sessão extraordinária</h2>
          <p className={darkMuted}>
            Treino manual para testar lista, sorteio, votação e Ao Vivo. Datas no fuso {timeZone}.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className={darkBtnGhost}>
          Fechar
        </button>
      </div>

      <TextField
        label="Data"
        name="date"
        type="date"
        required
        defaultValue={values?.date || defaultDate}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Início"
          name="startTime"
          type="time"
          required
          defaultValue={values?.startTime || "20:00"}
        />
        <TextField
          label="Término"
          name="endTime"
          type="time"
          required
          defaultValue={values?.endTime || "21:30"}
        />
      </div>
      <TextField
        label="Local / nome"
        name="venueName"
        maxLength={80}
        defaultValue={values?.venueName || DEFAULT_EXTRAORDINARY_VENUE}
        hint='Padrão: "Treino".'
      />
      <TextField
        label="Máximo de jogadores"
        name="maxPlayers"
        type="number"
        min={1}
        max={40}
        required
        defaultValue={values?.maxPlayers || String(defaultMaxPlayers)}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-white/75">Abertura da lista</legend>
        <label className={`flex min-h-11 items-center gap-2 ${darkBody}`}>
          <input
            type="radio"
            name="registrationMode"
            value="immediate"
            checked={(values?.registrationMode || registrationMode) === "immediate"}
            onChange={() => setRegistrationMode("immediate")}
            className="accent-smv-gold"
          />
          Imediatamente
        </label>
        <label className={`flex min-h-11 items-center gap-2 ${darkBody}`}>
          <input
            type="radio"
            name="registrationMode"
            value="scheduled"
            checked={(values?.registrationMode || registrationMode) === "scheduled"}
            onChange={() => setRegistrationMode("scheduled")}
            className="accent-smv-gold"
          />
          Em data/hora específica
        </label>
        {(values?.registrationMode || registrationMode) === "scheduled" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Data de abertura"
              name="registrationDate"
              type="date"
              required
              defaultValue={values?.registrationDate || defaultDate}
            />
            <TextField
              label="Hora de abertura"
              name="registrationTime"
              type="time"
              required
              defaultValue={values?.registrationTime || defaultPriorityTime}
            />
          </div>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Prazo mensalistas (data)"
          name="priorityDate"
          type="date"
          required
          defaultValue={values?.priorityDate || defaultDate}
          hint="Prioridade dos mensalistas até este instante."
        />
        <TextField
          label="Prazo mensalistas (hora)"
          name="priorityTime"
          type="time"
          required
          defaultValue={values?.priorityTime || defaultPriorityTime}
        />
      </div>

      <FormError message={state?.status === "error" ? state.error : undefined} />
      <SubmitButton pending={pending} label="Criar sessão extraordinária" pendingLabel="Criando…" />
    </form>
  );
}
