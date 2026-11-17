/**
 * Política pura de acesso financeiro (Phase 3).
 * ADMIN nunca fica em payment_restricted.
 * Locks só aplicam quando financeAccessLocksEnabled=true.
 */

export type AccessChargeSnapshot = {
  id: string;
  type: "MONTHLY_FEE" | "DAILY_FEE";
  amountCents: number;
  paidCents: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  /** MONTHLY: só bloqueia após ciclo CLOSED. DAILY: true após criação (sessão FINISHED). */
  isActivated: boolean;
  createdAt: Date;
  billingCycleId: string | null;
};

export type AccessGrantSnapshot = {
  id: string;
  kind: "MONTHLY" | "DAILY";
  relatedChargeId: string;
  grantedAt: Date;
  revokedAt: Date | null;
  /** freezesAt do ciclo que encerra liberação MONTHLY; null = ainda sem ciclo seguinte. */
  expiresAtCycleFreezesAt: Date | null;
};

export type FinancialAccessInput = {
  role: "ADMIN" | "PLAYER";
  financeAccessLocksEnabled: boolean;
  charges: AccessChargeSnapshot[];
  grants: AccessGrantSnapshot[];
  /** Cobranças DAILY_FEE criadas após o grant (para expirar liberação diária). */
  dailyChargesAfterGrant: Array<{ grantId: string; chargeId: string; createdAt: Date }>;
  now: Date;
};

export type FinancialAccessMode = "full" | "payment_restricted";

export type FinancialAccessResult = {
  mode: FinancialAccessMode;
  blockingChargeIds: string[];
  activeGrantId: string | null;
  reason:
    | "admin"
    | "locks_disabled"
    | "no_blocking_debt"
    | "exceptional_access"
    | "blocking_debt";
};

export function remainingCents(charge: AccessChargeSnapshot): number {
  if (charge.status === "CANCELLED" || charge.status === "PAID") return 0;
  return Math.max(charge.amountCents - charge.paidCents, 0);
}

export function isBlockingCharge(charge: AccessChargeSnapshot): boolean {
  if (!charge.isActivated) return false;
  return remainingCents(charge) > 0;
}

export function isGrantActive(
  grant: AccessGrantSnapshot,
  input: Pick<FinancialAccessInput, "now" | "dailyChargesAfterGrant">,
): boolean {
  if (grant.revokedAt) return false;
  if (grant.kind === "MONTHLY") {
    if (grant.expiresAtCycleFreezesAt && input.now.getTime() >= grant.expiresAtCycleFreezesAt.getTime()) {
      return false;
    }
    return true;
  }
  // DAILY: expira quando nasce nova diária cobrável após o grant
  const newer = input.dailyChargesAfterGrant.some(
    (row) => row.grantId === grant.id && row.createdAt.getTime() > grant.grantedAt.getTime(),
  );
  return !newer;
}

/** Charge IDs with an effective (non-expired, non-revoked) exceptional-access grant. */
export function activeExceptionalRelatedChargeIds(
  grants: AccessGrantSnapshot[],
  input: Pick<FinancialAccessInput, "now" | "dailyChargesAfterGrant">,
): Set<string> {
  const ids = new Set<string>();
  for (const grant of grants) {
    if (isGrantActive(grant, input)) ids.add(grant.relatedChargeId);
  }
  return ids;
}

/** Caminhos permitidos em modo payment_restricted (prefix match). */
export const PAYMENT_RESTRICTED_ALLOWED_PREFIXES = [
  "/pagamentos",
  "/financeiro",
  "/account",
  "/change-password",
  "/api/finance/",
] as const;

export function isPathAllowedWhenPaymentRestricted(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return PAYMENT_RESTRICTED_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix),
  );
}

export function evaluateFinancialAccess(input: FinancialAccessInput): FinancialAccessResult {
  if (input.role === "ADMIN") {
    return { mode: "full", blockingChargeIds: [], activeGrantId: null, reason: "admin" };
  }
  if (!input.financeAccessLocksEnabled) {
    return { mode: "full", blockingChargeIds: [], activeGrantId: null, reason: "locks_disabled" };
  }

  const blocking = input.charges.filter(isBlockingCharge).map((c) => c.id);
  if (blocking.length === 0) {
    return { mode: "full", blockingChargeIds: [], activeGrantId: null, reason: "no_blocking_debt" };
  }

  const activeGrant = input.grants.find((g) => isGrantActive(g, input));
  if (activeGrant) {
    return {
      mode: "full",
      blockingChargeIds: blocking,
      activeGrantId: activeGrant.id,
      reason: "exceptional_access",
    };
  }

  return {
    mode: "payment_restricted",
    blockingChargeIds: blocking,
    activeGrantId: null,
    reason: "blocking_debt",
  };
}

export type PlayerChargeUiStatus =
  | "pagamento_pendente"
  | "aguardando_aprovacao"
  | "parcialmente_pago"
  | "pago"
  | "comprovante_rejeitado"
  | "acesso_liberado_excepcionalmente";

export function resolvePlayerChargeUiStatus(input: {
  remainingCents: number;
  amountCents: number;
  paidCents: number;
  hasPendingReceipt: boolean;
  lastReceiptRejected: boolean;
  exceptionalAccess: boolean;
}): PlayerChargeUiStatus {
  if (input.remainingCents <= 0) return "pago";
  if (input.exceptionalAccess) return "acesso_liberado_excepcionalmente";
  if (input.hasPendingReceipt) return "aguardando_aprovacao";
  if (input.lastReceiptRejected) return "comprovante_rejeitado";
  if (input.paidCents > 0 && input.paidCents < input.amountCents) return "parcialmente_pago";
  return "pagamento_pendente";
}

export const PLAYER_CHARGE_STATUS_LABEL: Record<PlayerChargeUiStatus, string> = {
  pagamento_pendente: "Pagamento pendente",
  aguardando_aprovacao: "Aguardando aprovação",
  parcialmente_pago: "Parcialmente pago",
  pago: "Pago",
  comprovante_rejeitado: "Comprovante rejeitado",
  acesso_liberado_excepcionalmente: "Acesso liberado excepcionalmente",
};
