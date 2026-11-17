export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastInput = {
  /** Stable id for dedupe (same id replaces / ignores duplicate). */
  id?: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** ms; omitted = tone default. 0 = no auto-dismiss. */
  durationMs?: number;
};

export type ToastItem = Required<Pick<ToastInput, "id" | "tone" | "title">> & {
  description?: string;
  durationMs: number;
  createdAt: number;
};

export const TOAST_DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 10_000,
};

/** Cookie flash after Server Action redirect (no financial details). */
export const SMV_FLASH_COOKIE = "smv_flash";

/**
 * Opaque notice query for RSC redirects — cookies cannot be set during render.
 * No amounts, charge ids, or debt details.
 */
export const SMV_FLASH_QUERY = "aviso";
export const SMV_FLASH_PAYMENT_RESTRICTED = "restrito";

export type FlashToastPayload = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
};

export const PAYMENT_RESTRICTED_FLASH: FlashToastPayload = {
  id: "payment-restricted",
  tone: "warning",
  title: "Acesso temporariamente restrito",
  description:
    "Você possui um pagamento pendente. Regularize sua situação para continuar utilizando o SMV.",
};

/** Destino após bloqueio financeiro (RSC-safe). */
export function paymentRestrictedRedirectPath(): string {
  return `/pagamentos?${SMV_FLASH_QUERY}=${SMV_FLASH_PAYMENT_RESTRICTED}`;
}
