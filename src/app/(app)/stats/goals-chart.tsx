"use client";

import { useId } from "react";
import { darkCardPad, darkEmpty, darkMutedXs, darkSectionLabel } from "@/lib/ui/dark-surfaces";
import type { GoalsPerSessionSeries } from "@/domain/stats/dashboard";

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

export function GoalsChart({ series }: { series: GoalsPerSessionSeries }) {
  const gradientId = useId();
  if (series.points.length === 0) {
    return (
      <section className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkSectionLabel}>Gols por pelada</h2>
        <p className={darkEmpty}>Sem peladas encerradas neste período.</p>
      </section>
    );
  }

  const maxGoals = Math.max(...series.points.map((p) => p.goals), 1);
  const width = 360;
  const height = 180;
  const padL = 28;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const barGap = series.points.length > 8 ? 4 : 8;
  const barW = Math.max(10, (chartW - barGap * (series.points.length - 1)) / series.points.length);
  const avgY =
    series.average != null ? padT + chartH - (series.average / maxGoals) * chartH : null;

  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className={darkSectionLabel}>Gols por pelada</h2>
          <p className={darkMutedXs}>Últimas {series.points.length} encerradas · só GOAL válidos</p>
        </div>
        {series.average != null ? (
          <p className="text-sm text-white/55">
            Média <span className="font-semibold tabular-nums text-smv-gold-bright">{series.average.toFixed(1)}</span>
          </p>
        ) : null}
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          role="img"
          aria-label="Gráfico de gols por pelada"
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[280px]"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c9a227" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#c9a227" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((frac) => {
            const y = padT + chartH - frac * chartH;
            const label = Math.round(maxGoals * frac);
            return (
              <g key={frac}>
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
                <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-white/35 text-[9px]">
                  {label}
                </text>
              </g>
            );
          })}

          {avgY != null ? (
            <line
              x1={padL}
              x2={width - padR}
              y1={avgY}
              y2={avgY}
              stroke="rgba(201,162,39,0.55)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          ) : null}

          {series.points.map((point, index) => {
            const x = padL + index * (barW + barGap);
            const h = (point.goals / maxGoals) * chartH;
            const y = padT + chartH - h;
            return (
              <g key={point.sessionId}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, point.goals > 0 ? 2 : 0)}
                  rx={4}
                  fill={point.isLatest ? `url(#${gradientId})` : "rgba(255,255,255,0.28)"}
                />
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className={`text-[10px] font-semibold tabular-nums ${
                    point.isLatest ? "fill-smv-gold-bright" : "fill-white/70"
                  }`}
                >
                  {point.goals}
                </text>
                <text
                  x={x + barW / 2}
                  y={height - 12}
                  textAnchor="middle"
                  className={`text-[9px] ${point.isLatest ? "fill-smv-gold-bright" : "fill-white/45"}`}
                >
                  {formatDay(point.startsAt)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
