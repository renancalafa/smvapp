// Entrada/reativação de mensalistas: sem restrição de dia do mês.
// Financeiro: ensureLateJoinMonthlyChargeInTx nunca cobra o ciclo CLOSED corrente;
// a 1ª mensalidade nova sai no próximo freeze elegível (membro ACTIVE MONTHLY).

export type MonthlyJoinPolicy =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Sempre permite cadastro, promoção DAILY→MONTHLY e reativação de mensalista.
 * `monthlyFeeDueDay` continua valendo só como vencimento de pagamento.
 */
export function monthlyJoinPolicy(): MonthlyJoinPolicy {
  return { allowed: true };
}
