import type { FinancialAccessMode } from "@/domain/finance/accessPolicy";

const RESTRICTED_DESKTOP_HREFS = new Set(["/pagamentos", "/financeiro", "/account"]);

/** Destinos de menu quando o jogador está em payment_restricted. */
export function restrictedDesktopNavItems<T extends { href: string }>(items: T[]): T[] {
  return items.filter((item) => RESTRICTED_DESKTOP_HREFS.has(item.href));
}

export function restrictedMobileNavItems<T extends { href: string; label: string }>(
  _items: T[],
  paymentItem: T,
  financeItem: T,
): T[] {
  // Barra enxuta: Pagamentos + Financeiro; Conta/Sair no Mais.
  return [paymentItem, financeItem];
}

export function shouldUseRestrictedNav(mode: FinancialAccessMode): boolean {
  return mode === "payment_restricted";
}
