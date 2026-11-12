"use client";

import {
  darkBadge,
  darkBadgeSuccess,
  darkBadgeWarn,
  darkCardPad,
  darkEmpty,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import { formatAvg, type GoalsPerMatchSeries } from "@/domain/stats/dashboard";

function formatDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(date);
}

function trendLabel(trend: GoalsPerMatchSeries["trend"]): { text: string; className: string } | null {
  if (trend === "up") return { text: "Em alta", className: darkBadgeSuccess };
  if (trend === "down") return { text: "Em baixa", className: darkBadgeWarn };
  if (trend === "stable") return { text: "Estável", className: darkBadge };
  return null;
}

export function GoalsPerMatchChart({
  series,
  timeZone,
}: {
  series: GoalsPerMatchSeries;
  timeZone: string;
}) {
  const trend = trendLabel(series.trend);

  if (series.points.length === 0) {
    return (
      <section className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkSectionLabel}>Gols por partida · últimas 12</h2>
        <p className={darkEmpty}>Nenhuma partida finalizada com participação neste período.</p>
      </section>
    );
  }

  const maxGoals = Math.max(...series.points.map((point) => point.goals), 1);
  const width = 360;
  const height = 190;
  const padL = 28;
  const padR = 14;
  const padT = 18;
  const padB = 40;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const step = series.points.length === 1 ? 0 : chartW / (series.points.length - 1);

  const coords = series.points.map((point, index) => {
    const x = padL + index * step;
    const y = padT + chartH - (point.goals / maxGoals) * chartH;
    return { x, y, point };
  });

  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .join(" ");

  const periodAvgY =
    series.periodAverage != null
      ? padT + chartH - (series.periodAverage / maxGoals) * chartH
      : null;

  const latest = coords.find((coord) => coord.point.isLatest) ?? coords[coords.length - 1]!;

  const accessibleSummary = series.points
    .map(
      (point) =>
        `J${point.sequence} em ${formatDay(point.startedAt, timeZone)}: ${point.goals} gol${point.goals === 1 ? "" : "s"}`,
    )
    .join("; ");

  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={darkSectionLabel}>Gols por partida · últimas 12</h2>
            {trend ? <span className={trend.className}>{trend.text}</span> : null}
          </div>
          <p className={darkMutedXs}>
            {series.points.length} partida{series.points.length === 1 ? "" : "s"} · só GOAL válidos
            {series.periodMatchCount > series.points.length
              ? ` · período: ${series.periodMatchCount}`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-white/45">Média (exibidas)</p>
          <p className="text-xl font-semibold tabular-nums text-smv-gold-bright">
            {formatAvg(series.displayedAverage, 2)}
          </p>
          {series.periodAverage != null ? (
            <p className={darkMutedXs}>
              Média do período{" "}
              <span className="tabular-nums text-white/70">{formatAvg(series.periodAverage, 2)}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          role="img"
          aria-label={`Gráfico de gols por partida. Média das exibidas ${formatAvg(series.displayedAverage, 2)}. Média do período ${formatAvg(series.periodAverage, 2)}. ${accessibleSummary}`}
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[280px]"
        >
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

          {periodAvgY != null ? (
            <line
              x1={padL}
              x2={width - padR}
              y1={periodAvgY}
              y2={periodAvgY}
              stroke="rgba(201,162,39,0.55)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          ) : null}

          {coords.length > 1 ? (
            <path d={linePath} fill="none" stroke="#c9a227" strokeWidth={2.25} strokeLinejoin="round" />
          ) : null}

          {coords.map(({ x, y, point }) => (
            <g key={point.matchId}>
              <circle
                cx={x}
                cy={y}
                r={point.isLatest ? 5.5 : 3.5}
                fill={point.isLatest ? "#e4bc3c" : "rgba(255,255,255,0.55)"}
                stroke={point.isLatest ? "#0b1c2c" : "transparent"}
                strokeWidth={point.isLatest ? 1.5 : 0}
              />
              <text
                x={x}
                y={y - 8}
                textAnchor="middle"
                className={`text-[10px] font-semibold tabular-nums ${
                  point.isLatest ? "fill-smv-gold-bright" : "fill-white/55"
                }`}
              >
                {point.goals}
              </text>
              <text
                x={x}
                y={height - 18}
                textAnchor="middle"
                className={`text-[9px] ${point.isLatest ? "fill-smv-gold-bright" : "fill-white/45"}`}
              >
                {formatDay(point.startedAt, timeZone)}
              </text>
              <text
                x={x}
                y={height - 6}
                textAnchor="middle"
                className={`text-[8px] ${point.isLatest ? "fill-smv-gold/80" : "fill-white/30"}`}
              >
                J{point.sequence}
              </text>
            </g>
          ))}

          {latest ? (
            <g>
              <circle cx={latest.x} cy={latest.y} r={8} fill="rgba(228,188,60,0.15)" />
              <text
                x={Math.min(latest.x + 10, width - padR)}
                y={Math.max(latest.y - 14, padT + 8)}
                className="fill-smv-gold-bright text-[10px] font-semibold"
              >
                {latest.point.goals}g
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      <p className={darkMutedXs}>
        Linha tracejada = média do período ({series.periodMatchCount} partida
        {series.periodMatchCount === 1 ? "" : "s"}). Destaque dourado = partida mais recente.
      </p>
      {series.trend == null && series.points.length > 0 && series.points.length < 6 ? (
        <p className={darkMutedXs}>Tendência disponível a partir de 6 partidas no gráfico.</p>
      ) : null}
      {series.trend != null ? (
        <span className="sr-only">
          Tendência {trend?.text}. Compara a média das 3 partidas mais recentes com as 3 anteriores
          no gráfico.
        </span>
      ) : null}
    </section>
  );
}
