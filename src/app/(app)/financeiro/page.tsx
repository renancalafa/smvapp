import type { Metadata } from "next";
import Link from "next/link";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertWarn,
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
  darkStat,
  darkTitle,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { requireViewer } from "@/server/auth/dal";
import { getPlayerFinanceTransparency } from "@/server/modules/finance/transparency";
import { PlayerStatusTabs } from "./player-status-tabs";

export const metadata: Metadata = { title: "Financeiro" };
export const dynamic = "force-dynamic";

export default async function PlayerFinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string; pagina?: string }>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const pageNum = Number(params.pagina ?? "1");
  const data = await getPlayerFinanceTransparency(viewer, {
    cycleId: params.ciclo ?? null,
    movementsPage: Number.isFinite(pageNum) ? pageNum : 1,
  });

  const o = data.overview;
  const fee = data.feeBreakdown;
  const cycle = data.selectedCycle;

  if (!data.financeInitialized) {
    return (
      <section className="flex flex-col gap-5 pb-8">
        <header>
          <h1 className={darkTitle}>Financeiro</h1>
          <p className={`mt-1 ${darkMuted}`}>
            Transparência do caixa e das mensalidades do grupo. Somente leitura.
          </p>
        </header>
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Financeiro ainda não configurado</p>
          <p className="mt-1 text-sm text-amber-100/90">
            O caixa e as mensalidades ainda não foram implantados neste grupo. Assim que um
            administrador concluir a configuração, o extrato e os status de pagamento
            aparecerão aqui.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5 pb-8">
      <header>
        <h1 className={darkTitle}>Financeiro</h1>
        <p className={`mt-1 ${darkMuted}`}>
          Transparência do caixa e das mensalidades do grupo. Somente leitura.
        </p>
        {cycle ? (
          <p className={`mt-2 ${darkMutedXs}`}>
            Período: {cycle.referenceMonthLabel} ·{" "}
            {cycle.status === "OPEN" ? "ciclo aberto" : "ciclo fechado"}
            {cycle.isEstimate ? " · valores estimados" : ""}
          </p>
        ) : (
          <p className={`mt-2 ${darkMutedXs}`}>Nenhum ciclo financeiro disponível.</p>
        )}
      </header>

      {data.cycles.length > 0 ? (
        <nav aria-label="Ciclos" className="flex gap-2 overflow-x-auto pb-1">
          {data.cycles.map((c) => {
            const active = c.id === cycle?.id;
            const href = `/financeiro?ciclo=${c.id}`;
            return (
              <Link
                key={c.id}
                href={href}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${
                  active
                    ? "border-smv-gold/50 bg-smv-gold/15 text-smv-gold-bright"
                    : "border-white/15 bg-black/20 text-white/70"
                }`}
              >
                {c.referenceMonthLabel}
                {c.status === "OPEN" ? " · aberto" : ""}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className={darkStat}>
          <p className={darkMutedXs}>Caixa atual</p>
          <p className="text-base font-semibold text-smv-gold-bright">
            {formatCentsBRL(o.balanceCents)}
          </p>
        </div>
        <div className={darkStat}>
          <p className={darkMutedXs}>Mensalidades recebidas</p>
          <p className="text-base font-semibold text-emerald-200">
            {formatCentsBRL(o.monthlyIncomeCents)}
          </p>
        </div>
        <div className={darkStat}>
          <p className={darkMutedXs}>Diárias recebidas</p>
          <p className="text-base font-semibold text-emerald-200">
            {formatCentsBRL(o.dailyIncomeCents)}
          </p>
        </div>
        <div className={darkStat}>
          <p className={darkMutedXs}>Despesas registradas</p>
          <p className="text-base font-semibold text-rose-200">
            {formatCentsBRL(o.recordedExpenseCents)}
          </p>
        </div>
        <div className={darkStat}>
          <p className={darkMutedXs}>Ainda em aberto</p>
          <p className="text-base font-semibold text-white">{formatCentsBRL(o.outstandingCents)}</p>
        </div>
        <div className={darkStat}>
          <p className={darkMutedXs}>Mensalidade atual</p>
          <p className="text-base font-semibold text-white">
            {o.monthlyFeeCents == null ? "—" : formatCentsBRL(o.monthlyFeeCents)}
          </p>
        </div>
      </div>

      <p className={darkMutedXs}>
        Entradas confirmadas no caixa: {formatCentsBRL(o.confirmedIncomeCents)}. Declarações
        aguardando aprovação não entram no caixa.
      </p>

      {fee ? (
        <section className={`flex flex-col gap-3 ${darkCardPad}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={darkTitleMd}>Como a mensalidade é calculada</h2>
            {fee.isEstimate ? (
              <span className={darkBadgeGold}>Estimativa</span>
            ) : (
              <span className={darkBadge}>Congelado</span>
            )}
          </div>
          {fee.isEstimate ? (
            <p className={darkAlertWarn}>
              O ciclo ainda está aberto. Os valores abaixo são uma projeção até o Admin congelar o
              mês.
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className={darkMutedXs}>Custo da quadra (snapshot)</dt>
              <dd className="font-semibold text-white">{formatCentsBRL(fee.fieldCostSnapshotCents)}</dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Custo configurado</dt>
              <dd className="font-semibold text-white">
                {fee.configuredFieldCostCents == null
                  ? "—"
                  : formatCentsBRL(fee.configuredFieldCostCents)}
              </dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Pago à quadra (caixa)</dt>
              <dd className="font-semibold text-rose-200">{formatCentsBRL(o.courtPaidCents)}</dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Mensalistas pagantes</dt>
              <dd className="font-semibold text-white">{fee.payingMonthlyCount}</dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Crédito disponível</dt>
              <dd className="font-semibold text-white">
                {formatCentsBRL(fee.availableEligibleCreditCents)}
              </dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Crédito aprovado / aplicado</dt>
              <dd className="font-semibold text-smv-gold-bright">
                {formatCentsBRL(fee.appliedCreditCents)}
              </dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Valor a ratear</dt>
              <dd className="font-semibold text-white">{formatCentsBRL(fee.amountToSplitCents)}</dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Mensalidade por jogador</dt>
              <dd className="text-lg font-semibold text-smv-cream">
                {formatCentsBRL(fee.monthlyFeeCents)}
              </dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Total cobrado</dt>
              <dd className="font-semibold text-white">{formatCentsBRL(fee.totalChargedCents)}</dd>
            </div>
            <div>
              <dt className={darkMutedXs}>Sobra de arredondamento</dt>
              <dd className="font-semibold text-white">{formatCentsBRL(fee.roundingSurplusCents)}</dd>
            </div>
          </dl>
          <p className={darkMutedXs}>
            Só o crédito aprovado pelo administrador reduz a mensalidade. Diárias no caixa não são
            descontadas automaticamente.
          </p>
        </section>
      ) : null}

      <PlayerStatusTabs monthly={data.playerStatuses.monthly} daily={data.playerStatuses.daily} />

      <section className={`flex flex-col gap-3 ${darkCardPad}`}>
        <h2 className={darkTitleMd}>Movimentações</h2>
        <p className={darkMutedXs}>
          Histórico do período selecionado. Sem comprovantes, PIX ou dados bancários.
        </p>
        {data.movements.items.length === 0 ? (
          <p className={darkMuted}>Nenhum lançamento neste período.</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {data.movements.items.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-white">{row.description}</p>
                  <p className={darkMutedXs}>
                    {new Date(row.occurredAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {row.referenceMonth ? ` · ${row.referenceMonth}` : ""}
                    {" · "}
                    {row.categoryLabel}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-medium ${
                    row.direction === "IN" ? "text-emerald-200" : "text-rose-200"
                  }`}
                >
                  {row.direction === "IN" ? "+" : "−"}
                  {formatCentsBRL(row.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.movements.totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className={darkMutedXs}>
              Página {data.movements.page} de {data.movements.totalPages}
            </p>
            <div className="flex gap-2">
              {data.movements.page > 1 ? (
                <Link
                  href={`/financeiro?ciclo=${cycle?.id ?? ""}&pagina=${data.movements.page - 1}`}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80"
                >
                  Anterior
                </Link>
              ) : null}
              {data.movements.page < data.movements.totalPages ? (
                <Link
                  href={`/financeiro?ciclo=${cycle?.id ?? ""}&pagina=${data.movements.page + 1}`}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80"
                >
                  Próxima
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <p className={`${darkSectionLabel} text-center`}>
        Pagamentos pessoais e comprovantes ficam em{" "}
        <Link href="/pagamentos" className="text-smv-gold underline-offset-2 hover:underline">
          Pagamentos
        </Link>
        .
      </p>
    </section>
  );
}
