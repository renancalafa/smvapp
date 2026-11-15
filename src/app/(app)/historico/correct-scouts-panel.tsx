"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import {
  ALL_MATCH_EVENT_TYPES,
  MATCH_EVENT_LABELS,
  isMatchEventType,
  type MatchEventType,
} from "@/domain/match/events";
import {
  darkAlertError,
  darkAlertWarn,
  darkBtnDanger,
  darkBtnPrimary,
  darkBtnSecondary,
  darkControl,
  darkMuted,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  addHistoricalMatchEventAction,
  correctHistoricalMatchEventAction,
  voidHistoricalMatchEventAction,
  type HistoricalCorrectionState,
} from "@/server/modules/matches/historical-actions";
import type { HistoricoMatchDetail } from "@/server/modules/historico/queries";

function newOperationId(): string {
  return crypto.randomUUID();
}

function useOperationId(state: HistoricalCorrectionState): string {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  return useMemo(() => newOperationId(), [state]);
}

function playerLabel(player: HistoricoMatchDetail["players"][number]): string {
  const base = player.nickname ? `${player.name} (${player.nickname})` : player.name;
  return player.leftAt ? `${base} · saiu` : base;
}

type Mode = "list" | "add" | "edit" | "void";

export function CorrectScoutsPanel({
  sessionId,
  match: initialMatch,
  teamNameById,
  onClose,
  onApplied,
}: {
  sessionId: string;
  match: HistoricoMatchDetail;
  teamNameById: Map<string, string>;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [match, setMatch] = useState(initialMatch);
  const [mode, setMode] = useState<Mode>("list");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const selectedEvent = match.events.find((event) => event.id === selectedEventId) ?? null;

  function applyMatchView(next: {
    version: number;
    scoreA: number;
    scoreB: number;
    events: HistoricoMatchDetail["events"];
  }) {
    setMatch((prev) => ({
      ...prev,
      version: next.version,
      scoreA: next.scoreA,
      scoreB: next.scoreB,
      events: next.events,
    }));
  }

  function handleDone(state: HistoricalCorrectionState) {
    if (state?.status !== "done") return;
    const view = state.match;
    applyMatchView({
      version: view.version,
      scoreA: view.scoreA,
      scoreB: view.scoreB,
      events: view.events.map((event) => ({
        id: event.id,
        type: event.type,
        memberId: event.memberId,
        memberName: event.memberName,
        teamId: event.teamId,
        assistMemberId: event.assistMemberId,
        assistName: event.assistName,
        elapsedSec: event.elapsedSec,
        voidedAt: event.voidedAt,
      })),
    });
    setMode("list");
    setSelectedEventId(null);
    onApplied();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-scouts-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-smv-navy text-smv-cream shadow-2xl ring-1 ring-white/15 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 id="correct-scouts-title" className={darkTitleMd}>
              Corrigir scouts
            </h2>
            <p className={darkMutedXs}>
              J{match.sequence} · {match.teamAName} {match.scoreA}×{match.scoreB} {match.teamBName}
            </p>
          </div>
          <button type="button" className={darkBtnSecondary} onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {mode === "list" ? (
            <EventList
              match={match}
              teamNameById={teamNameById}
              onAdd={() => setMode("add")}
              onEdit={(eventId) => {
                setSelectedEventId(eventId);
                setMode("edit");
              }}
              onVoid={(eventId) => {
                setSelectedEventId(eventId);
                setMode("void");
              }}
            />
          ) : null}

          {mode === "add" ? (
            <AddEventForm
              sessionId={sessionId}
              match={match}
              teamNameById={teamNameById}
              onCancel={() => setMode("list")}
              onDone={handleDone}
            />
          ) : null}

          {mode === "edit" && selectedEvent && !selectedEvent.voidedAt ? (
            <EditEventForm
              sessionId={sessionId}
              match={match}
              event={selectedEvent}
              teamNameById={teamNameById}
              onCancel={() => {
                setMode("list");
                setSelectedEventId(null);
              }}
              onDone={handleDone}
            />
          ) : null}

          {mode === "void" && selectedEvent && !selectedEvent.voidedAt ? (
            <VoidEventForm
              sessionId={sessionId}
              match={match}
              event={selectedEvent}
              onCancel={() => {
                setMode("list");
                setSelectedEventId(null);
              }}
              onDone={handleDone}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EventList({
  match,
  teamNameById,
  onAdd,
  onEdit,
  onVoid,
}: {
  match: HistoricoMatchDetail;
  teamNameById: Map<string, string>;
  onAdd: () => void;
  onEdit: (eventId: string) => void;
  onVoid: (eventId: string) => void;
}) {
  const active = match.events.filter((event) => !event.voidedAt);
  const voided = match.events.filter((event) => event.voidedAt);

  return (
    <div className="flex flex-col gap-3">
      <p className={darkMuted}>
        Correções administrativas em partida finalizada. Não reabre a partida nem a sessão.
      </p>
      <button type="button" className={`${darkBtnPrimary} w-full`} onClick={onAdd}>
        Adicionar evento
      </button>
      {active.length === 0 ? (
        <p className={darkMutedXs}>Nenhum evento válido.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((event) => (
            <li
              key={event.id}
              className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5"
            >
              <p className="text-sm text-white">
                <span className="tabular-nums text-white/40">
                  {Math.floor(event.elapsedSec / 60)}′
                </span>{" "}
                {isMatchEventType(event.type) ? MATCH_EVENT_LABELS[event.type] : event.type} ·{" "}
                {event.memberName}
                {event.assistName ? ` (assist. ${event.assistName})` : ""}
              </p>
              <p className={darkMutedXs}>
                {teamNameById.get(event.teamId) ?? "Time"}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={`${darkBtnSecondary} flex-1 text-sm`}
                  onClick={() => onEdit(event.id)}
                >
                  Corrigir
                </button>
                <button
                  type="button"
                  className={`${darkBtnDanger} flex-1 text-sm`}
                  onClick={() => onVoid(event.id)}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {voided.length > 0 ? (
        <details className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
          <summary className="cursor-pointer text-sm text-white/60">
            Anulados ({voided.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-white/45">
            {voided.map((event) => (
              <li key={event.id}>
                {isMatchEventType(event.type) ? MATCH_EVENT_LABELS[event.type] : event.type} ·{" "}
                {event.memberName}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ReasonField({ id, defaultValue = "" }: { id: string; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
      Motivo da correção
      <textarea
        id={id}
        name="reason"
        required
        rows={3}
        defaultValue={defaultValue}
        placeholder="Ex.: gol atribuído ao jogador errado"
        className={`${darkControl} min-h-[5.5rem] resize-y`}
      />
    </label>
  );
}

function StateBanner({ state }: { state: HistoricalCorrectionState }) {
  if (!state) return null;
  if (state.status === "error") return <p className={darkAlertError}>{state.error}</p>;
  if (state.status === "conflict") {
    return (
      <p className={darkAlertWarn}>
        {state.error} Atualize a lista e tente de novo (outro admin pode ter editado).
      </p>
    );
  }
  return null;
}

function AddEventForm({
  sessionId,
  match,
  teamNameById,
  onCancel,
  onDone,
}: {
  sessionId: string;
  match: HistoricoMatchDetail;
  teamNameById: Map<string, string>;
  onCancel: () => void;
  onDone: (state: HistoricalCorrectionState) => void;
}) {
  const [state, action, pending] = useActionState(addHistoricalMatchEventAction, undefined);
  const operationId = useOperationId(state);
  const formId = useId();
  const [type, setType] = useState<MatchEventType>("BIG_MISS");
  const [memberId, setMemberId] = useState(match.players[0]?.memberId ?? "");
  const selected = match.players.find((player) => player.memberId === memberId);
  const assistCandidates = match.players.filter(
    (player) => player.memberId !== memberId && player.teamId === selected?.teamId,
  );

  useEffect(() => {
    onDone(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="expectedVersion" value={String(match.version)} />
      <input type="hidden" name="operationId" value={operationId} />

      <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
        Tipo
        <select
          name="type"
          className={darkControl}
          value={type}
          onChange={(event) => setType(event.target.value as MatchEventType)}
        >
          {ALL_MATCH_EVENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {MATCH_EVENT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
        Jogador
        <select
          name="memberId"
          required
          className={darkControl}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          {match.players.map((player) => (
            <option key={player.memberId} value={player.memberId}>
              {playerLabel(player)} · {teamNameById.get(player.teamId) ?? "Time"}
            </option>
          ))}
        </select>
      </label>

      {type === "GOAL" ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
          Assistência (opcional)
          <select name="assistMemberId" className={darkControl} defaultValue="">
            <option value="">Sem assistência</option>
            {assistCandidates.map((player) => (
              <option key={player.memberId} value={player.memberId}>
                {playerLabel(player)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <ReasonField id={`${formId}-reason`} />
      <StateBanner state={state} />
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${darkBtnSecondary} flex-1`} onClick={onCancel} disabled={pending}>
          Voltar
        </button>
        <button type="submit" className={`${darkBtnPrimary} flex-1`} disabled={pending || !memberId}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}

function EditEventForm({
  sessionId,
  match,
  event,
  teamNameById,
  onCancel,
  onDone,
}: {
  sessionId: string;
  match: HistoricoMatchDetail;
  event: HistoricoMatchDetail["events"][number];
  teamNameById: Map<string, string>;
  onCancel: () => void;
  onDone: (state: HistoricalCorrectionState) => void;
}) {
  const [state, action, pending] = useActionState(correctHistoricalMatchEventAction, undefined);
  const operationId = useOperationId(state);
  const formId = useId();
  const initialType = isMatchEventType(event.type) ? event.type : "BIG_MISS";
  const [type, setType] = useState<MatchEventType>(initialType);
  const [memberId, setMemberId] = useState(event.memberId);
  const selected = match.players.find((player) => player.memberId === memberId);
  const assistCandidates = match.players.filter(
    (player) => player.memberId !== memberId && player.teamId === selected?.teamId,
  );

  useEffect(() => {
    onDone(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="expectedVersion" value={String(match.version)} />
      <input type="hidden" name="operationId" value={operationId} />

      <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
        Tipo
        <select
          name="type"
          className={darkControl}
          value={type}
          onChange={(event) => setType(event.target.value as MatchEventType)}
        >
          {ALL_MATCH_EVENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {MATCH_EVENT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
        Jogador
        <select
          name="memberId"
          required
          className={darkControl}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          {match.players.map((player) => (
            <option key={player.memberId} value={player.memberId}>
              {playerLabel(player)} · {teamNameById.get(player.teamId) ?? "Time"}
            </option>
          ))}
        </select>
      </label>

      {type === "GOAL" ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-white/75">
          Assistência (opcional)
          <select
            name="assistMemberId"
            className={darkControl}
            defaultValue={event.assistMemberId ?? ""}
          >
            <option value="">Sem assistência</option>
            {assistCandidates.map((player) => (
              <option key={player.memberId} value={player.memberId}>
                {playerLabel(player)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="assistMemberId" value="" />
      )}

      <ReasonField id={`${formId}-reason`} />
      <StateBanner state={state} />
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${darkBtnSecondary} flex-1`} onClick={onCancel} disabled={pending}>
          Voltar
        </button>
        <button type="submit" className={`${darkBtnPrimary} flex-1`} disabled={pending}>
          {pending ? "Salvando…" : "Salvar correção"}
        </button>
      </div>
    </form>
  );
}

function VoidEventForm({
  sessionId,
  match,
  event,
  onCancel,
  onDone,
}: {
  sessionId: string;
  match: HistoricoMatchDetail;
  event: HistoricoMatchDetail["events"][number];
  onCancel: () => void;
  onDone: (state: HistoricalCorrectionState) => void;
}) {
  const [state, action, pending] = useActionState(voidHistoricalMatchEventAction, undefined);
  const operationId = useOperationId(state);
  const formId = useId();

  useEffect(() => {
    onDone(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="expectedVersion" value={String(match.version)} />
      <input type="hidden" name="operationId" value={operationId} />
      <p className="text-sm text-white/80">
        Remover{" "}
        <span className="font-semibold">
          {isMatchEventType(event.type) ? MATCH_EVENT_LABELS[event.type] : event.type}
        </span>{" "}
        de {event.memberName}?
      </p>
      <ReasonField id={`${formId}-reason`} />
      <StateBanner state={state} />
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${darkBtnSecondary} flex-1`} onClick={onCancel} disabled={pending}>
          Voltar
        </button>
        <button type="submit" className={`${darkBtnDanger} flex-1`} disabled={pending}>
          {pending ? "Removendo…" : "Confirmar remoção"}
        </button>
      </div>
    </form>
  );
}
