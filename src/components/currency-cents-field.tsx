"use client";

import { useId, useState } from "react";
import { darkControl, darkHint, darkLabel } from "@/lib/ui/dark-surfaces";
import { centsFromDigits, formatCentsBRL, parseBRLToCents } from "@/lib/money";

export type CurrencyCentsFieldProps = {
  label: string;
  /** Nome do campo hidden enviado como centavos inteiros. */
  name: string;
  defaultCents?: number | null;
  hint?: string;
  required?: boolean;
  /** Permite R$ 0,00 (crédito zero, custo zero, etc.). Default true. */
  allowZero?: boolean;
  /** Permite vazio (ex.: pagamento parcial opcional = quitar). Default false. */
  allowEmpty?: boolean;
  minCents?: number;
  maxCents?: number;
  className?: string;
  disabled?: boolean;
  /** Notifica mudanças para prévias em formulários compostos. */
  onCentsChange?: (cents: number | null) => void;
};

/**
 * Campo BRL mobile-first: exibe R$ 1.234,56; submete centavos inteiros no `name`.
 * Digitação por máscara de centavos; cola "15,50" / "1.234,56" via parse BRL.
 */
export function CurrencyCentsField({
  label,
  name,
  defaultCents = null,
  hint,
  required = false,
  allowZero = true,
  allowEmpty = false,
  minCents,
  maxCents,
  className,
  disabled,
  onCentsChange,
}: CurrencyCentsFieldProps) {
  const displayId = useId();
  const initial =
    defaultCents == null || !Number.isInteger(defaultCents)
      ? allowEmpty
        ? null
        : 0
      : defaultCents;
  const [cents, setCents] = useState<number | null>(initial);

  function commit(next: number | null) {
    if (next == null) {
      const value = allowEmpty ? null : 0;
      setCents(value);
      onCentsChange?.(value);
      return;
    }
    let value = next;
    if (minCents != null && value < minCents) value = minCents;
    if (maxCents != null && value > maxCents) value = maxCents;
    setCents(value);
    onCentsChange?.(value);
  }

  const display = cents == null ? "" : formatCentsBRL(cents);
  const hiddenValue = cents == null ? "" : String(cents);
  const zeroNotAllowed = !allowZero && cents === 0;

  return (
    <label className={darkLabel} htmlFor={displayId}>
      {label}
      <input type="hidden" name={name} value={hiddenValue} />
      <input
        id={displayId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        disabled={disabled}
        required={required && (cents == null || zeroNotAllowed)}
        aria-invalid={zeroNotAllowed || undefined}
        className={`${darkControl}${className ? ` ${className}` : ""}`}
        value={display}
        placeholder="R$ 0,00"
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          const parsed = parseBRLToCents(text);
          if (parsed == null || parsed < 0) return;
          event.preventDefault();
          commit(parsed);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw.trim()) {
            commit(allowEmpty ? null : 0);
            return;
          }
          const parsed = centsFromDigits(raw);
          if (parsed == null) {
            if (allowEmpty) commit(null);
            return;
          }
          commit(parsed);
        }}
      />
      {hint && <span className={darkHint}>{hint}</span>}
    </label>
  );
}
