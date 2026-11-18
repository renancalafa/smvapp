import type { Metadata } from "next";
import Link from "next/link";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertWarn,
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkLinkCard,
  darkList,
  darkListRow,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
  darkStat,
  darkTitle,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { getAdminFinanceDashboard } from "@/server/modules/finance/queries";
import { getAdminReceiptQueue } from "@/server/modules/finance/player-queries";
import { db } from "@/server/db";
import {
  CreditApprovalCard,
  FinancialMovementsPanel,
  FreezeCycleCard,
} from "./finance-forms";
import { InitializeFinanceCard } from "./initialize-finance-card";
import { ReceiptReviewQueue } from "./receipt-review";
import { FinanceLocksToggle } from "./locks-toggle";

export const metadata: Metadata = { title: "Financeiro" };
export const dynamic = "force-dynamic";

function cycleStatusLabel(status: string): string {
  if (status === "OPEN") return "Aberto";
  if (status === "CLOSED") return "Fechado";
  return status;
}

function cycleKindLabel(kind: string): string {
  if (kind === "OPENING") return "Abertura";
  if (kind === "REGULAR") return "Regular";
  return kind;
}

function cashCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    PAYMENT: "Pagamento",
    FIELD_COST: "Campo",
    OTHER_EXPENSE: "Despesa",
    ADJUSTMENT: "Ajuste",
    OPENING_BALANCE: "Saldo inicial",
    INITIAL_BALANCE: "Saldo inicial",
    MONTHLY_FEE: "Mensalidade",
    DAILY_FEE: "Diária",
    CREDIT_CARRY: "Crédito",
    REVERSAL: "Estorno",
  };
  return map[category] ?? category;
}

export default async function AdminFinanceiroPage() {
  const viewer = await requireAdmin();
  const [data, receiptQueue, settings] = await Promise.all([
    getAdminFinanceDashboard(viewer.group.id, viewer.group.timezone),
    getAdminReceiptQueue(viewer.group.id),
    db.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
      select: { financeAccessLocksEnabled: true },
    }),
  ]);
  const tz = data.timezone;
  const setup = data.financeSetupState;
  const operational = setup === "initialized";
  const orphan = setup === "orphan";
  const uninitialized = setup === "uninitialized";

  return (
    <section className="flex flex-col gap-6 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className={darkTitle}>Financeiro</h1>
          <p className={`mt-1 ${darkMutedXs}`}>
            Caixa, cobranças e confirmação de pagamentos · {tz}
          </p>
        </div>
        <Link href="/admin/configuracoes?tab=financeiro" className={`${shellBackLink} underline`}>
          Configurações
        </Link>
      </header>

      {uninitialized ? (
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Financeiro ainda não configurado</p>
          <p className="mt-1 text-sm text-amber-100/90">
            Faça a implantação única abaixo (saldo, mensalidade de referência e dívidas iniciais
            opcionais). Até lá, o app não gera ciclos, mensalidades nem diárias automaticamente — a
            pelada continua normal.
          </p>
        </div>
      ) : null}

      {orphan ? (
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">
            Dados financeiros de teste anteriores à implantação
          </p>
          <p className="mt-1 text-sm text-amber-100/90">
            Este grupo tem ciclos, cobranças ou lançamentos, mas não tem ciclo OPENING — não é uma
            implantação válida. A implantação automática está bloqueada para não duplicar histórico.
            Use o grupo de laboratório financeiro local (finance-lab) para testes limpos, ou peça
            remediação explícita sem apagar estes registros.
          </p>
        </div>
      ) : null}

      {operational || orphan ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={darkStat}>
            <p className={darkMutedXs}>Caixa</p>
            <p className="text-base font-semibold text-smv-gold-bright">
              {formatCentsBRL(data.balanceCents)}
            </p>
          </div>
          <div className={darkStat}>
            <p className={darkMutedXs}>Em aberto</p>
            <p className="text-base font-semibold text-white">
              {formatCentsBRL(data.outstandingCents)}
            </p>
          </div>
          <div className={darkStat}>
            <p className={darkMutedXs}>Entradas</p>
            <p className="text-base font-semibold text-emerald-200">
              {formatCentsBRL(data.confirmedIncomeCents)}
            </p>
          </div>
          <div className={darkStat}>
            <p className={darkMutedXs}>Saídas</p>
            <p className="text-base font-semibold text-rose-200">
              {formatCentsBRL(data.recordedExpenseCents)}
            </p>
          </div>
        </div>
      ) : null}

      {operational ? (
        <ReceiptReviewQueue
          timeZone={tz}
          items={receiptQueue.map((r) => ({
            ...r,
            createdAt: r.createdAt.toLocaleString("pt-BR", {
              timeZone: tz,
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          }))}
        />
      ) : null}

      {operational ? (
        <FinanceLocksToggle enabled={settings?.financeAccessLocksEnabled === true} />
      ) : null}

      {uninitialized ? (
        <InitializeFinanceCard
          monthlyMembers={data.monthlyMembers.map((m) => ({
            id: m.id,
            name: m.name,
            feeExempt: m.feeExempt,
          }))}
        />
      ) : null}

      {operational &&
      ((data.openCycle && data.creditPreview && data.forecast) || data.openCycle) ? (
        <section className="flex flex-col gap-3">
          <h2 className={darkSectionLabel}>Ciclo aberto</h2>
          {data.openCycle && data.creditPreview && data.forecast ? (
            <CreditApprovalCard
              cycleId={data.openCycle.id}
              availableCents={data.creditPreview.availableCents}
              approvedCreditCents={data.creditPreview.approvedCreditCents}
              priorUnallocatedCents={data.creditPreview.priorUnallocatedCents}
              dailyEligibleCents={data.creditPreview.dailyEligibleCents}
              forecastMonthlyFeeCents={data.forecast.monthlyFeeCents}
              fieldCostCents={data.openCycle.fieldCostSnapshotCents}
              payingCount={data.forecast.payingMonthlyCount}
              freezesAtLabel={new Date(data.openCycle.freezesAt).toLocaleString("pt-BR", {
                timeZone: tz,
              })}
            />
          ) : null}
          {data.openCycle ? (
            <FreezeCycleCard
              cycleId={data.openCycle.id}
              label={`${data.openCycle.referenceMonth} · corte ${new Date(
                data.openCycle.freezesAt,
              ).toLocaleString("pt-BR", { timeZone: tz })}`}
            />
          ) : null}
        </section>
      ) : null}

      {operational ? (
        <FinancialMovementsPanel
          timeZone={tz}
          charges={data.outstandingCharges.map((c) => ({
            id: c.id,
            remainingCents: c.remainingCents,
            label: `${c.memberName} · ${c.type === "DAILY_FEE" ? "Diária" : "Mensalidade"}`,
          }))}
          cycleOptions={data.cycles.map((c) => ({
            value: c.id,
            label: `${c.referenceMonth} · ${cycleStatusLabel(c.status)}${
              c.kind === "OPENING" ? " (abertura)" : ""
            }`,
          }))}
        />
      ) : null}

      {operational || orphan ? (
        <section className="flex flex-col gap-2">
          <h2 className={darkSectionLabel}>
            {orphan ? "Cobranças legadas (somente leitura)" : "Cobranças em aberto"}
          </h2>
          {data.outstandingCharges.length === 0 ? (
            <p className={`${darkMuted} ${darkCardPad}`}>Nenhuma cobrança pendente.</p>
          ) : (
            <ul className={darkList}>
              {data.outstandingCharges.slice(0, 20).map((c) => (
                <li key={c.id} className={darkListRow}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{c.memberName}</p>
                    <p className={darkMutedXs}>
                      {c.type === "DAILY_FEE" ? "Diária" : "Mensalidade"} · pago{" "}
                      {formatCentsBRL(c.paidCents)} / {formatCentsBRL(c.amountCents)}
                    </p>
                  </div>
                  <span className={darkBadgeGold}>{formatCentsBRL(c.remainingCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {operational || orphan ? (
        <section className="flex flex-col gap-2">
          <h2 className={darkSectionLabel}>{orphan ? "Ciclos legados" : "Ciclos"}</h2>
          {data.cycles.length === 0 ? (
            <p className={`${darkMuted} ${darkCardPad}`}>Nenhum ciclo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.cycles.map((c) =>
                operational ? (
                  <Link
                    key={c.id}
                    href={`/admin/financeiro/ciclos/${c.id}`}
                    className={darkLinkCard}
                  >
                    <div>
                      <p className="font-semibold text-white">{c.referenceMonth}</p>
                      <p className={darkMutedXs}>
                        {cycleKindLabel(c.kind)} · corte{" "}
                        {new Date(c.freezesAt).toLocaleString("pt-BR", { timeZone: tz })}
                        {c.monthlyFeeCents != null
                          ? ` · mensalidade ${formatCentsBRL(c.monthlyFeeCents)}`
                          : ""}
                      </p>
                    </div>
                    <span className={c.status === "OPEN" ? darkBadgeGold : darkBadge}>
                      {cycleStatusLabel(c.status)}
                    </span>
                  </Link>
                ) : (
                  <div key={c.id} className={darkLinkCard}>
                    <div>
                      <p className="font-semibold text-white">{c.referenceMonth}</p>
                      <p className={darkMutedXs}>
                        {cycleKindLabel(c.kind)} · corte{" "}
                        {new Date(c.freezesAt).toLocaleString("pt-BR", { timeZone: tz })}
                        {c.monthlyFeeCents != null
                          ? ` · mensalidade ${formatCentsBRL(c.monthlyFeeCents)}`
                          : ""}
                      </p>
                    </div>
                    <span className={c.status === "OPEN" ? darkBadgeGold : darkBadge}>
                      {cycleStatusLabel(c.status)}
                    </span>
                  </div>
                ),
              )}
            </ul>
          )}
        </section>
      ) : null}

      {operational || orphan ? (
        <section className={`flex flex-col gap-2 ${darkCardPad}`}>
          <h2 className={darkTitleMd}>
            {orphan ? "Lançamentos legados" : "Últimos lançamentos"}
          </h2>
          {data.recentCash.length === 0 ? (
            <p className={darkMuted}>Nenhum lançamento ainda.</p>
          ) : (
            <ul className="divide-y divide-white/8">
              {data.recentCash.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-white">
                      {cashCategoryLabel(row.category)}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </p>
                    <p className={darkMutedXs}>
                      {new Date(row.recordedAt).toLocaleString("pt-BR", { timeZone: tz })}
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
        </section>
      ) : null}
    </section>
  );
}
