"use client";

import type { PreferredRole } from "@/domain/ratings/attributes";
import { darkMutedXs, darkPanel } from "@/lib/ui/dark-surfaces";

const OPTIONS: Array<{ value: PreferredRole | null; label: string; short: string }> = [
  { value: null, label: "Não definido", short: "—" },
  { value: "ATTACKER", label: "Atacante", short: "A" },
  { value: "DEFENDER", label: "Defensor", short: "D" },
  { value: "VERSATILE", label: "Versátil", short: "V" },
];

function roleLabel(value: PreferredRole | null): string {
  return OPTIONS.find((o) => o.value === value)?.label ?? "Não definido";
}

export function PreferredRolePills({
  value,
  onChange,
  currentValue,
}: {
  value: PreferredRole | null;
  onChange: (value: PreferredRole | null) => void;
  currentValue: PreferredRole | null;
}) {
  const changed = value !== currentValue;

  return (
    <div className={`${darkPanel} flex flex-col gap-2.5 px-3 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-smv-cream">Papel preferido</p>
        <p className={darkMutedXs}>
          Atual: {roleLabel(currentValue)}
          {changed ? (
            <span className="text-smv-gold-bright"> → {roleLabel(value)}</span>
          ) : null}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Papel preferido no campo"
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
      >
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.short + option.label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                selected
                  ? "bg-smv-gold/20 text-smv-gold-bright ring-1 ring-smv-gold/45"
                  : "bg-black/30 text-white/65 ring-1 ring-white/10 hover:bg-white/8 hover:text-smv-cream"
              }`}
            >
              <span className="text-sm font-semibold">{option.short}</span>
              <span className="text-[11px] font-medium opacity-90">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
