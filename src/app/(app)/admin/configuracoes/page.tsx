import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { auditActionLabel } from "@/domain/audit/labels";
import {
  activationInputPartsInZone,
  civilFromReferenceMonth,
  defaultFreezesAt,
  formatActivationDateTimePt,
  formatReferenceMonthLabelPt,
} from "@/domain/finance/cycleDates";
import { darkTitle } from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { getConfigFinanceBundle } from "@/server/modules/finance/queries";
import { getSessionFormatSettings } from "@/server/modules/group-settings/queries";
import { ConfigTabs, type ConfigTabId } from "./config-tabs";
import { FinanceSettingsForm } from "./finance-settings-form";
import { SessionSettingsForm } from "./session-settings-form";

export const metadata: Metadata = { title: "Configurações" };
export const dynamic = "force-dynamic";

function resolveTab(raw: string | string[] | undefined): ConfigTabId {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === "financeiro" ? "financeiro" : "sessoes";
}

export default async function AdminConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const tab = resolveTab(sp.tab);

  const [sessionSettings, financeBundle] = await Promise.all([
    getSessionFormatSettings(viewer.group.id),
    getConfigFinanceBundle(viewer.group.id),
  ]);

  if (!sessionSettings || !financeBundle.settings) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className={darkTitle}>Configurações</h1>
        <p className={shellSubtext}>Configurações do grupo não encontradas.</p>
      </section>
    );
  }

  const tz = financeBundle.group.timezone;
  const now = new Date();
  const monthCivil = {
    year: Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(now)),
    month: Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(now)),
    day: 1,
  };
  const defaultCut = defaultFreezesAt(monthCivil, tz);

  const financeAudits = financeBundle.financeAudits
    .filter((row) => {
      if (row.action !== "GROUP_SETTINGS_UPDATED") return true;
      const meta = row.metadata as { section?: string } | null;
      return meta?.section === "finance" || meta?.section === "session_format";
    })
    .slice(0, 15)
    .map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt.toLocaleString("pt-BR", { timeZone: tz }),
      summary: auditActionLabel(row.action),
    }));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className={darkTitle}>Configurações</h1>
        <Link href="/admin" className={`${shellBackLink} underline`}>
          Voltar
        </Link>
      </div>

      <Suspense fallback={null}>
        <ConfigTabs active={tab} />
      </Suspense>

      {tab === "sessoes" ? (
        <SessionSettingsForm
          defaults={{
            ...sessionSettings,
            timeZone: tz,
          }}
        />
      ) : (
        <FinanceSettingsForm
          defaults={{
            dailyFeeCents: financeBundle.settings.dailyFeeCents,
            monthlyFieldCostCents: financeBundle.settings.monthlyFieldCostCents,
            pixKey: financeBundle.settings.pixKey,
            pixKeyType: financeBundle.settings.pixKeyType,
            pixBeneficiaryName: financeBundle.settings.pixBeneficiaryName,
            timezone: tz,
            defaultActivationHint: `sexta 08:00 após a 1ª quinta · exemplo ${formatActivationDateTimePt(defaultCut, tz)}`,
            openCycles: financeBundle.openCycles.map((c) => {
              const civil = civilFromReferenceMonth(c.referenceMonth);
              const automatic = defaultFreezesAt(civil, tz);
              const parts = activationInputPartsInZone(c.freezesAt, tz);
              return {
                id: c.id,
                monthLabel: formatReferenceMonthLabelPt(civil),
                currentOpeningLabel: formatActivationDateTimePt(c.freezesAt, tz),
                defaultOpeningLabel: formatActivationDateTimePt(automatic, tz),
                differsFromDefault: c.freezesAt.getTime() !== automatic.getTime(),
                dateValue: parts.date,
                timeValue: parts.time,
              };
            }),
            monthlyMembers: financeBundle.members.map((m) => ({
              id: m.id,
              name: m.user.name,
              username: m.user.username,
              feeExempt: m.feeExempt,
              feeExemptReason: m.feeExemptReason,
              role: m.role,
            })),
            auditRows: financeAudits,
          }}
        />
      )}
    </section>
  );
}
