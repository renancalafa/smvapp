// Janela de entrada de mensalistas (PROJECT.md, seção 31.8): do dia 1 ao dia
// monthlyFeeDueDay do mês, no fuso do grupo. Vale para novos mensalistas e para a
// reativação de mensalistas inativos, só depois da implantação financeira.
import { civilDateInZone } from "@/domain/time/zoned";

export function isMonthlyJoinWindowOpen(
  instant: Date,
  timeZone: string,
  monthlyFeeDueDay: number,
): boolean {
  return civilDateInZone(instant, timeZone).day <= monthlyFeeDueDay;
}

export type MonthlyJoinPolicy =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Antes da implantação, mensalistas entram livremente. Depois, só na janela; e mesmo na
 * janela a entrada exige a cobrança LATE_JOIN do ciclo, que depende do módulo financeiro.
 */
export function monthlyJoinPolicy(input: {
  financialGoLiveDone: boolean;
  now: Date;
  timeZone: string;
  monthlyFeeDueDay: number;
}): MonthlyJoinPolicy {
  if (!input.financialGoLiveDone) return { allowed: true };
  if (!isMonthlyJoinWindowOpen(input.now, input.timeZone, input.monthlyFeeDueDay)) {
    return {
      allowed: false,
      reason: `Mensalistas só podem entrar ou ser reativados do dia 1 ao dia ${input.monthlyFeeDueDay} do mês.`,
    };
  }
  return {
    allowed: false,
    reason: "A entrada ou reativação de mensalista após a implantação financeira depende do módulo de cobranças, ainda não disponível.",
  };
}
