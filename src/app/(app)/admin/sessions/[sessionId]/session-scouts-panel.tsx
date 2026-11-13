"use client";

import { useActionState } from "react";
import {
  darkAlertError,
  darkAlertSuccess,
  darkBtnDanger,
  darkBtnPrimary,
  darkControl,
  darkEmptyCompact,
  darkLabel,
  darkList,
  darkMuted,
  darkMutedXs,
} from "@/lib/ui/dark-surfaces";
import { shellSectionLabel } from "@/lib/ui/shell-text";
import {
  assignSessionScoutAction,
  revokeSessionScoutAction,
  type ScoutActionState,
} from "@/server/modules/scouts/actions";
import type { SessionScoutRow } from "@/server/modules/scouts/queries";

function Feedback({ state }: { state: ScoutActionState }) {
  if (!state) return null;
  if (state.status === "error") return <p className={darkAlertError}>{state.error}</p>;
  return <p className={darkAlertSuccess}>{state.message}</p>;
}

function scoutLabel(row: SessionScoutRow): string {
  return row.nickname ? `${row.name} (${row.nickname})` : row.name;
}

export function SessionScoutsPanel({
  sessionId,
  canManage,
  active,
  history,
  candidates,
}: {
  sessionId: string;
  canManage: boolean;
  active: SessionScoutRow[];
  history: SessionScoutRow[];
  candidates: { userId: string; label: string }[];
}) {
  const [assignState, assignAction, assigning] = useActionState(assignSessionScoutAction, undefined);
  const [revokeState, revokeAction, revoking] = useActionState(revokeSessionScoutAction, undefined);

  return (
    <section className="flex flex-col gap-3">
      <h2 className={shellSectionLabel}>Scouts da sessão</h2>
      <p className={darkMuted}>
        Scouts operam partidas no Ao Vivo desta sessão (cronômetro, gols, substituições). Não alteram lista,
        sorteio nem configuração.
      </p>

      {active.length === 0 ? (
        <p className={darkEmptyCompact}>Nenhum scout ativo.</p>
      ) : (
        <ul className={darkList}>
          {active.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{scoutLabel(row)}</p>
                <p className={darkMutedXs}>
                  @{row.username} · desde {new Date(row.assignedAt).toLocaleString("pt-BR")} · por{" "}
                  {row.assignedByName}
                </p>
              </div>
              {canManage ? (
                <form action={revokeAction} className="shrink-0">
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="sessionScoutId" value={row.id} />
                  <button type="submit" disabled={revoking} className={`min-h-10 px-3 ${darkBtnDanger}`}>
                    {revoking ? "Revogando…" : "Revogar"}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Feedback state={revokeState} />

      {canManage ? (
        <form action={assignAction} className="flex flex-col gap-2">
          <label className={darkLabel}>
            Atribuir scout
            <select name="userId" required disabled={assigning || candidates.length === 0} className={darkControl}>
              <option value="">{candidates.length === 0 ? "Ninguém disponível" : "Selecione…"}</option>
              {candidates.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button
            type="submit"
            disabled={assigning || candidates.length === 0}
            className={`min-h-11 w-full ${darkBtnPrimary}`}
          >
            {assigning ? "Atribuindo…" : "Atribuir scout"}
          </button>
          <Feedback state={assignState} />
        </form>
      ) : (
        <p className={darkEmptyCompact}>Sessão encerrada ou cancelada: não dá para atribuir novos scouts.</p>
      )}

      {history.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className={darkMutedXs}>Histórico de revogações</h3>
          <ul className="flex flex-col gap-1">
            {history.map((row) => (
              <li key={row.id} className={`rounded-lg px-3 py-2 ${darkMuted}`}>
                {scoutLabel(row)} · revogado{" "}
                {row.revokedAt ? new Date(row.revokedAt).toLocaleString("pt-BR") : "—"}
                {row.revokedByName ? ` por ${row.revokedByName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
