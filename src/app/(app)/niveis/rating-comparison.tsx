import { darkMutedXs, darkPanel } from "@/lib/ui/dark-surfaces";
import { ratingChangeDirection, type RatingChangeDirection } from "./format";

function proposedTone(direction: RatingChangeDirection): string {
  if (direction === "up") return "text-emerald-300";
  if (direction === "down") return "text-rose-300";
  return "text-smv-cream";
}

function directionHint(direction: RatingChangeDirection): string {
  if (direction === "up") return "Aumento";
  if (direction === "down") return "Redução";
  if (direction === "assign") return "Atribuição inicial";
  return "Sem alteração";
}

/**
 * Snapshot comparison from proposal.fromValue → toValue (never live player ratings).
 * Also used as a live preview in the suggest modal.
 */
export function RatingComparison({
  fromValue,
  toValue,
  attributeLabel,
}: {
  fromValue: number | null;
  toValue: number;
  attributeLabel?: string;
}) {
  const direction = ratingChangeDirection(fromValue, toValue);
  const proposedClass = proposedTone(direction);

  return (
    <div
      className={`${darkPanel} flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3`}
      aria-label={`${attributeLabel ? `${attributeLabel}: ` : ""}${fromValue == null ? "Sem nota" : fromValue} para ${toValue}. ${directionHint(direction)}.`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {attributeLabel ? (
          <p className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-white/45 sm:text-left">
            {attributeLabel}
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-3 sm:gap-4">
          <div className="flex min-w-[3.25rem] flex-col items-center gap-0.5">
            <span className={darkMutedXs}>Atual</span>
            {fromValue == null ? (
              <span className="text-sm font-semibold text-white/55">Sem nota</span>
            ) : (
              <span className="text-2xl font-semibold tabular-nums text-white/70">{fromValue}</span>
            )}
          </div>

          <span className="shrink-0 text-lg font-semibold text-white/35" aria-hidden>
            →
          </span>

          <div className="flex min-w-[3.25rem] flex-col items-center gap-0.5">
            <span className={darkMutedXs}>Proposta</span>
            <span className={`text-2xl font-semibold tabular-nums ${proposedClass}`}>{toValue}</span>
          </div>
        </div>
      </div>

      <span
        className={`mx-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 sm:mx-0 ${
          direction === "up"
            ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30"
            : direction === "down"
              ? "bg-rose-400/15 text-rose-200 ring-rose-300/30"
              : direction === "assign"
                ? "bg-sky-400/15 text-sky-100 ring-sky-300/30"
                : "bg-white/8 text-white/55 ring-white/10"
        }`}
      >
        {directionHint(direction)}
      </span>
    </div>
  );
}
