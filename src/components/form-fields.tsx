import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import {
  darkAlertError,
  darkBtnDanger,
  darkBtnPrimary,
  darkBtnSecondary,
  darkControl,
  darkHint,
  darkLabel,
} from "@/lib/ui/dark-surfaces";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  hint?: string;
};

export function TextField({ label, name, hint, className, ...props }: TextFieldProps) {
  return (
    <label className={darkLabel}>
      {label}
      <input name={name} className={`${darkControl}${className ? ` ${className}` : ""}`} {...props} />
      {hint && <span className={darkHint}>{hint}</span>}
    </label>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string; disabled?: boolean }[];
  hint?: string;
};

export function SelectField({ label, name, options, hint, className, ...props }: SelectFieldProps) {
  return (
    <label className={darkLabel}>
      {label}
      <select name={name} className={`${darkControl}${className ? ` ${className}` : ""}`} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled} className="bg-smv-navy text-smv-cream">
            {option.label}
          </option>
        ))}
      </select>
      {hint && <span className={darkHint}>{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={darkAlertError}>
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
    primary: darkBtnPrimary,
    secondary: darkBtnSecondary,
    danger: darkBtnDanger,
  }[variant];
  return (
    <button type="submit" disabled={pending} className={`w-full ${variantClass}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
