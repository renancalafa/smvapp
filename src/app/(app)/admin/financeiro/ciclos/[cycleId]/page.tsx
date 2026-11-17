import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCentsBRL } from "@/lib/money";
import {
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkList,
  darkListRow,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
  darkTitle,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { civilFromReferenceMonth } from "@/domain/finance/cycleDates";
import { getCycleDetail } from "@/server/modules/finance/queries";

export const metadata: Metadata = { title: "Ciclo financeiro" };
export const dynamic = "force-dynamic";

export default async function AdminFinanceCyclePage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const viewer = await requireAdmin();
  const { cycleId } = await params;
  const cycle = await getCycleDetail(viewer.group.id, cycleId);
  if (!cycle) notFound();

  const tz = viewer.group.timezone;
  const civil = civilFromReferenceMonth(cycle.referenceMonth);
  const label = `${String(civil.month).padStart(2, "0")}/${civil.year}`;

  return (
    <section className="flex flex-col gap-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className={darkTitle}>Ciclo {label}</h1>
        <Link href="/admin/financeiro" className={`${shellBackLink} underline`}>
          Voltar
        </Link>
      </div>

      <div className={darkCardPad}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cycle.status === "OPEN" ? darkBadgeGold : darkBadge}>{cycle.status}</span>
          <span className={darkBadge}>{cycle.kind}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className={darkMutedXs}>Corte / ativação</dt>
            <dd className="text-white">{cycle.freezesAt.toLocaleString("pt-BR", { timeZone: tz })}</dd>
          </div>
          <div>
            <dt className={darkMutedXs}>Custo campo (snapshot)</dt>
            <dd className="text-white">{formatCentsBRL(cycle.fieldCostSnapshotCents)}</dd>
          </div>
          {cycle.status === "CLOSED" && cycle.kind === "REGULAR" && (
            <>
              <div>
                <dt className={darkMutedXs}>Disponível no corte</dt>
                <dd className="text-white">{formatCentsBRL(cycle.eligibleDailyRevenueCents ?? 0)}</dd>
              </div>
              <div>
                <dt className={darkMutedXs}>Crédito aplicado</dt>
                <dd className="text-white">{formatCentsBRL(cycle.carriedCreditCents ?? 0)}</dd>
              </div>
              <div>
                <dt className={darkMutedXs}>A dividir</dt>
                <dd className="text-white">{formatCentsBRL(cycle.amountToSplitCents ?? 0)}</dd>
              </div>
              <div>
                <dt className={darkMutedXs}>Pagantes</dt>
                <dd className="text-white">{cycle.payingMonthlyCount ?? 0}</dd>
              </div>
              <div>
                <dt className={darkMutedXs}>Mensalidade</dt>
                <dd className="text-lg font-semibold text-smv-gold-bright">
                  {formatCentsBRL(cycle.monthlyFeeCents ?? 0)}
                </dd>
              </div>
              <div>
                <dt className={darkMutedXs}>Arredondamento</dt>
                <dd className="text-white">{formatCentsBRL(cycle.roundingDifferenceCents ?? 0)}</dd>
              </div>
              <div>
                <dt className={darkMutedXs}>Congelado em</dt>
                <dd className="text-white">
                  {cycle.closedAt?.toLocaleString("pt-BR", { timeZone: tz }) ?? "—"}
                </dd>
              </div>
            </>
          )}
          {cycle.kind === "OPENING" && (
            <div>
              <dt className={darkMutedXs}>Mensalidade declarada</dt>
              <dd className="text-white">{formatCentsBRL(cycle.monthlyFeeCents ?? 0)}</dd>
            </div>
          )}
        </dl>
      </div>

      {cycle.creditAllocationsAsTarget.length > 0 && (
        <section className={darkCardPad}>
          <h2 className={darkTitleMd}>Créditos</h2>
          <ul className="divide-y divide-white/8">
            {cycle.creditAllocationsAsTarget.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <p className="text-white">
                  {formatCentsBRL(a.amountCents)} · {a.status}
                </p>
                <p className={darkMutedXs}>
                  Disponível na aprovação {formatCentsBRL(a.availableSnapshotCents)} ·{" "}
                  {a.approvedAt.toLocaleString("pt-BR", { timeZone: tz })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <p className={darkSectionLabel}>Cobranças</p>
        {cycle.charges.length === 0 ? (
          <p className={darkMuted}>Sem cobranças neste ciclo.</p>
        ) : (
          <ul className={darkList}>
            {cycle.charges.map((c) => {
              const paid = c.payments.reduce((s, p) => s + p.amountCents, 0);
              const remaining = Math.max(c.amountCents - paid, 0);
              return (
                <li key={c.id} className={darkListRow}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{c.member.user.name}</p>
                    <p className={darkMutedXs}>
                      {c.type}
                      {c.monthlyFeeOrigin ? `/${c.monthlyFeeOrigin}` : ""} ·{" "}
                      {formatCentsBRL(paid)}/{formatCentsBRL(c.amountCents)}
                    </p>
                  </div>
                  <span className={remaining > 0 ? darkBadgeGold : darkBadge}>
                    {c.status}
                    {remaining > 0 ? ` · ${formatCentsBRL(remaining)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`flex flex-col gap-2 ${darkCardPad}`}>
        <h2 className={darkTitleMd}>Caixa do ciclo</h2>
        {cycle.cashTransactions.length === 0 ? (
          <p className={darkMuted}>Sem lançamentos.</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {cycle.cashTransactions.map((row) => (
              <li key={row.id} className="flex justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="text-white">
                    {row.category}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </p>
                  <p className={darkMutedXs}>
                    {row.recordedAt.toLocaleString("pt-BR", { timeZone: tz })}
                  </p>
                </div>
                <span className={row.direction === "IN" ? "text-emerald-200" : "text-rose-200"}>
                  {row.direction === "IN" ? "+" : "−"}
                  {formatCentsBRL(row.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
