"use client";

import { useEffect, useState } from "react";

/** Tempo restante exibido a partir dos timestamps do servidor (sobrevive a refresh). */
export function computeDisplayedRemainingMs(
  remainingMs: number,
  serverNow: string,
  paused: boolean,
  nowMs: number = Date.now(),
): number {
  const syncedAt = new Date(serverNow).getTime();
  const drift = paused ? 0 : Math.max(0, nowMs - syncedAt);
  return Math.max(0, remainingMs - drift);
}

/** Cronômetro derivado dos timestamps do servidor; sobrevive a refresh. */
export function MatchTimer({
  remainingMs,
  serverNow,
  paused,
  plannedDurationSec,
}: {
  remainingMs: number;
  serverNow: string;
  paused: boolean;
  plannedDurationSec: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = computeDisplayedRemainingMs(remainingMs, serverNow, paused, now);
  const expired = left <= 0;
  const total = plannedDurationSec * 1000;
  const mm = String(Math.floor(left / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");

  useEffect(() => {
    if (paused || expired) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [paused, expired, remainingMs, serverNow]);

  // Expirado tem prioridade sobre pausado: 00:00 não é “Pausado”.
  const timeClass = expired ? "text-red-300" : paused ? "text-amber-200" : "text-white";
  const status = expired
    ? "Tempo esgotado"
    : paused
      ? "Pausado"
      : `de ${Math.round(total / 60_000)} min`;

  return (
    <div className="flex flex-col items-center gap-1">
      <p className={`font-mono text-4xl font-semibold tracking-tight ${timeClass}`}>
        {mm}:{ss}
      </p>
      <p className={`text-xs ${expired ? "font-medium text-red-200/90" : "text-white/50"}`}>{status}</p>
    </div>
  );
}
