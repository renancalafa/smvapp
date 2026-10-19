"use client";

import { useEffect, useState } from "react";

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
  const syncedAt = new Date(serverNow).getTime();
  const remainingAtSync = remainingMs;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [paused]);

  const drift = paused ? 0 : Math.max(0, now - syncedAt);
  const left = Math.max(0, remainingAtSync - drift);
  const total = plannedDurationSec * 1000;
  const mm = String(Math.floor(left / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const expired = left <= 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <p
        className={`font-mono text-4xl font-semibold tracking-tight ${
          expired ? "text-red-700" : paused ? "text-amber-700" : "text-zinc-900"
        }`}
      >
        {mm}:{ss}
      </p>
      <p className="text-xs text-zinc-500">
        {paused ? "Pausado" : expired ? "Tempo esgotado" : `de ${Math.round(total / 60_000)} min`}
      </p>
    </div>
  );
}
