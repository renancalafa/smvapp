"use client";

import {
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { darkMutedXs, darkPanel } from "@/lib/ui/dark-surfaces";

function stars(value: number): string {
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

function valueFromPointer(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 1;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.min(5, Math.max(1, Math.round(ratio * 4) + 1));
}

type RequiredProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  currentValue?: number | null;
  required?: true;
  nullable?: false;
  /** Compact mode hides the “Atual → Nova” header chrome (useful when a separate preview exists). */
  compact?: boolean;
};

type NullableProps = {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  currentValue?: number | null;
  required?: false;
  nullable: true;
  compact?: boolean;
};

export type RatingStepBarProps = RequiredProps | NullableProps;

export function RatingStepBar(props: RatingStepBarProps) {
  const { label, compact = false } = props;
  const currentValue = props.currentValue ?? null;
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const selected = props.value;
  const hasRating = selected != null;
  const displayValue = hasRating ? selected : null;

  const setFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const next = valueFromPointer(track, clientX);
      if (props.nullable) props.onChange(next);
      else props.onChange(next);
    },
    [props],
  );

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event.clientX);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setFromPointer(event.clientX);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (props.nullable && props.value == null) {
      if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === " ") {
        event.preventDefault();
        props.onChange(1);
      }
      return;
    }
    const current = props.value ?? 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(5, current + 1);
      if (props.nullable) props.onChange(next);
      else props.onChange(next);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.max(1, current - 1);
      if (props.nullable) props.onChange(next);
      else props.onChange(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (props.nullable) props.onChange(1);
      else props.onChange(1);
    } else if (event.key === "End") {
      event.preventDefault();
      if (props.nullable) props.onChange(5);
      else props.onChange(5);
    }
  }

  const changed =
    props.currentValue !== undefined ? props.value !== props.currentValue : false;

  return (
    <div className={`${darkPanel} flex flex-col gap-2.5 px-3 py-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold text-smv-cream">
            {label}
            {props.required ? (
              <span className="ml-1 text-smv-gold-bright" aria-hidden>
                *
              </span>
            ) : null}
          </p>
          {!compact ? (
            <p className={darkMutedXs}>
              Atual:{" "}
              {currentValue == null ? (
                <span className="text-white/45">Sem nota</span>
              ) : (
                <span className="tabular-nums text-white/70">
                  {currentValue} · {stars(currentValue)}
                </span>
              )}
              {changed ? (
                <span className="text-smv-gold-bright">
                  {" "}
                  →{" "}
                  {displayValue == null ? (
                    "Sem nota"
                  ) : (
                    <span className="tabular-nums">
                      {displayValue} · {stars(displayValue)}
                    </span>
                  )}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {props.nullable ? (
            <button
              type="button"
              onClick={() => props.onChange(null)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                props.value == null
                  ? "bg-white/12 text-smv-cream ring-white/25"
                  : "bg-transparent text-white/50 ring-white/10 hover:bg-white/8 hover:text-white/75"
              }`}
              aria-pressed={props.value == null}
            >
              Sem nota
            </button>
          ) : null}
          <span
            className={`min-w-[2.25rem] text-right text-xl font-semibold tabular-nums ${
              displayValue == null ? "text-white/35" : "text-smv-gold-bright"
            }`}
            aria-hidden
          >
            {displayValue ?? "—"}
          </span>
        </div>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={displayValue ?? undefined}
        aria-valuetext={
          displayValue == null ? "Sem nota" : `${displayValue} de 5, ${stars(displayValue)}`
        }
        className={`relative touch-none select-none rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-smv-gold/50 ${
          props.nullable && props.value == null ? "opacity-55" : ""
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((step) => {
            const active = displayValue != null && step <= displayValue;
            const exact = displayValue === step;
            return (
              <button
                key={step}
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={() => {
                  if (props.nullable) props.onChange(step);
                  else props.onChange(step);
                }}
                className={`flex h-10 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors ${
                  active
                    ? exact
                      ? "bg-smv-gold text-smv-navy shadow-sm shadow-smv-gold/30"
                      : "bg-smv-gold/55 text-smv-navy"
                    : "bg-black/35 text-white/40 ring-1 ring-white/10"
                }`}
              >
                {step}
              </button>
            );
          })}
        </div>
      </div>

      {displayValue != null ? (
        <p className="text-center text-xs text-smv-gold-bright/90">{stars(displayValue)}</p>
      ) : (
        <p className="text-center text-xs text-white/40">
          Toque numa barra para atribuir nota, ou mantenha “Sem nota”.
        </p>
      )}
    </div>
  );
}
