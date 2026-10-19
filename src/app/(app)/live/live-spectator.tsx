"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollIntervalMs, shouldPollWhileVisible } from "@/domain/live/polling";
import type { SpectatorLiveSnapshot } from "@/server/modules/matches/spectator";
import { formatSessionTitle, formatTime } from "../sessions/format";
import { SpectatorBoard } from "./spectator-board";

async function fetchLiveSnapshot(
  since: string | null,
  signal: AbortSignal,
): Promise<{ kind: "not-modified" } | { kind: "ok"; snapshot: SpectatorLiveSnapshot } | { kind: "unauthorized" }> {
  const headers: HeadersInit = { Accept: "application/json" };
  if (since) headers["If-None-Match"] = `"${since}"`;

  const response = await fetch("/api/live", {
    method: "GET",
    headers,
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });

  if (response.status === 304) return { kind: "not-modified" };
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) throw new Error(`live poll failed: ${response.status}`);
  const snapshot = (await response.json()) as SpectatorLiveSnapshot;
  return { kind: "ok", snapshot };
}

/**
 * Polling adaptativo do Ao Vivo: 5s ativo / 10s espera / 30s idle / para ao encerrar.
 * Aba oculta suspende; ao voltar, refresh imediato. Abort cancela requests obsoletos.
 */
export function LiveSpectator({
  initial,
  timeZone,
}: {
  initial: SpectatorLiveSnapshot;
  timeZone: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const snapshotRef = useRef(snapshot);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const scheduleNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(
    async (forceImmediate: boolean) => {
      if (!shouldPollWhileVisible(document.hidden) && !forceImmediate) return;

      const phase = snapshotRef.current.pollPhase;
      if (phase === "ended" && !forceImmediate) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generation = ++generationRef.current;

      try {
        const result = await fetchLiveSnapshot(snapshotRef.current.revision, controller.signal);
        if (generation !== generationRef.current || controller.signal.aborted) return;
        if (result.kind === "unauthorized") {
          router.replace("/login");
          return;
        }
        if (result.kind === "ok") {
          setSnapshot(result.snapshot);
          snapshotRef.current = result.snapshot;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Ao Vivo: falha no polling", error);
      }
    },
    [router],
  );

  const scheduleNext = useCallback(() => {
    clearTimer();
    if (!shouldPollWhileVisible(document.hidden)) return;
    const interval = pollIntervalMs(snapshotRef.current.pollPhase);
    if (interval === null) return;
    timerRef.current = window.setTimeout(() => {
      void (async () => {
        await pollOnce(false);
        scheduleNextRef.current();
      })();
    }, interval);
  }, [clearTimer, pollOnce]);

  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  useEffect(() => {
    scheduleNext();

    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        abortRef.current?.abort();
        return;
      }
      void (async () => {
        await pollOnce(true);
        scheduleNextRef.current();
      })();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      abortRef.current?.abort();
      generationRef.current += 1;
    };
  }, [clearTimer, pollOnce, scheduleNext]);

  // Quando o pollPhase muda (ex.: active → ended), reprograma o intervalo.
  useEffect(() => {
    scheduleNext();
  }, [snapshot.pollPhase, scheduleNext]);

  const { state } = snapshot;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Ao Vivo</h1>
        <p className="text-sm text-zinc-600">Placar e partidas da pelada — somente leitura</p>
      </div>

      {state.kind === "idle" && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
          <p className="text-base font-medium text-zinc-800">Nenhuma sessão ativa no momento</p>
          <p className="mt-1 text-sm text-zinc-600">
            Quando a pelada começar, o placar, o cronômetro e o histórico aparecem aqui
            automaticamente.
          </p>
        </div>
      )}

      {(state.kind === "live" || state.kind === "ended") && (
        <>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-sm font-medium capitalize text-zinc-900">
              {formatSessionTitle(new Date(state.session.startsAt), timeZone)}
            </p>
            <p className="text-sm text-zinc-600">
              {formatTime(new Date(state.session.startsAt), timeZone)} às{" "}
              {formatTime(new Date(state.session.endsAt), timeZone)}
              {state.session.venueName ? ` · ${state.session.venueName}` : ""}
            </p>
          </div>
          <SpectatorBoard board={state.board} sessionEnded={state.kind === "ended"} />
        </>
      )}
    </section>
  );
}
