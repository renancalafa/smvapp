import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

const CONTROL_CLASS =
  "min-h-12 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base font-normal text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:bg-zinc-100 disabled:text-zinc-500";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  hint?: string;
};

export function TextField({ label, name, hint, ...props }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      {label}
      <input name={name} className={CONTROL_CLASS} {...props} />
      {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
    </label>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string; disabled?: boolean }[];
  hint?: string;
};

export function SelectField({ label, name, options, hint, ...props }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
      {label}
      <select name={name} className={CONTROL_CLASS} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
  variant = "primary",
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const variantClass = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    secondary: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-12 w-full rounded-lg px-4 py-2.5 font-medium disabled:opacity-60 ${variantClass}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
