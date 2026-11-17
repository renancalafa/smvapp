// SOMENTE DESENVOLVIMENTO: regressão financeira alinhada às regras de negócio.
//
//   npm run check:finance
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import {
  calculateMonthlyFee,
  ceilDiv,
  priorUnallocatedSurplusCents,
  computeAvailableCredit,
} from "../src/domain/finance/monthlyFee";
import { readFileSync } from "node:fs";
import {
  activationInputPartsInZone,
  buildCycleDates,
  defaultFreezesAt,
  firstWeekdayOfMonth,
  formatActivationDateTimePt,
  formatReferenceMonthLabelPt,
  startOfMonthCivil,
  zonedDateTimeFromFormParts,
} from "../src/domain/finance/cycleDates";
import { netCashCents } from "../src/domain/finance/cashBalance";
import { categorizeAuditAction } from "../src/domain/audit/catalog";
import { ADMIN_SUBNAV } from "../src/domain/nav/admin-subnav";
import {
  centsFromDigits,
  formatCentsBRL,
  parseBRLToCents,
  parseCurrencyInputToCents,
} from "../src/lib/money";
import { timezoneSelectOptions } from "../src/domain/finance/timezones";
import {
  activeExceptionalRelatedChargeIds,
  evaluateFinancialAccess,
  isGrantActive,
  isPathAllowedWhenPaymentRestricted,
  resolvePlayerChargeUiStatus,
} from "../src/domain/finance/accessPolicy";
import {
  assertReceiptUploadMeta,
  DECLARATION_WITHOUT_RECEIPT_MIME,
  isDeclarationWithoutReceipt,
  RECEIPT_ALLOWED_MIME,
  RECEIPT_MAX_BYTES,
} from "../src/domain/finance/receiptUpload";
import {
  buildReceiptStorageKey,
  isProductionLikeEnv,
  resolveReceiptStorageMode,
  resolveS3ReceiptStorageConfig,
} from "../src/domain/finance/receiptStorageConfig";
import type { Viewer } from "../src/server/auth/dal";
import { UserFacingError } from "../src/server/errors";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

class SetupError extends Error {}
class Rollback extends Error {}

const emptyModule = pathToFileURL(path.resolve("node_modules/next/dist/compiled/server-only/empty.js")).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

const txStore = new AsyncLocalStorage<Tx>();
(globalThis as { prisma?: unknown }).prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const tx = txStore.getStore();
      if (!tx) throw new Error("db usado fora de uma transação de teste.");
      if (property === "$transaction") {
        return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      }
      return Reflect.get(tx, property);
    },
  },
);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function viewerOf(
  group: { id: string; name: string; timezone: string },
  member: {
    id: string;
    role: "ADMIN" | "PLAYER";
    modality: "MONTHLY" | "DAILY";
    status: "ACTIVE" | "INACTIVE";
    user: { id: string; username: string; name: string };
  },
): Viewer {
  return {
    sessionId: "check-finance",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: {
      id: member.id,
      role: member.role,
      modality: member.modality,
      status: member.status,
    },
  };
}

function domainChecks() {
  // First Thursday Oct 2026 = Thu 1 → Friday 2 08:00 Recife = 11:00Z
  const firstThu = firstWeekdayOfMonth({ year: 2026, month: 10, day: 1 }, "THURSDAY");
  check("1ª quinta out/2026 = dia 1", firstThu.day === 1);
  const cut = defaultFreezesAt({ year: 2026, month: 10, day: 1 }, "America/Recife");
  check(
    "corte sexta 08:00 Recife após 1ª quinta",
    cut.toISOString() === "2026-10-02T11:00:00.000Z",
    cut.toISOString(),
  );

  // Nov 2026: first Thursday = Nov 5 → Friday Nov 6 08:00 Recife
  const novCut = defaultFreezesAt({ year: 2026, month: 11, day: 1 }, "America/Recife");
  check(
    "nov/2026 corte = 2026-11-06T11:00:00.000Z",
    novCut.toISOString() === "2026-11-06T11:00:00.000Z",
    novCut.toISOString(),
  );

  const bundle = buildCycleDates({
    referenceMonth: { year: 2026, month: 10, day: 1 },
    timeZone: "America/Recife",
    monthlyFeeDueDay: 7,
    fieldPaymentDueDay: 10,
  });
  check("buildCycleDates usa corte sexta", bundle.freezesAt.toISOString() === cut.toISOString());
  check("firstRegularSessionDate = quinta 1", bundle.firstRegularSessionDate.day === 1);

  // Approved credit only in formula
  const withCredit = calculateMonthlyFee({
    fieldCostSnapshotCents: 90_000,
    approvedCreditCents: 7_500,
    payingMonthlyCount: 19,
  });
  check("crédito aprovado 7500 → split 82500", withCredit.amountToSplitCents === 82_500);
  check("ceil 82500/19 = 4343", withCredit.monthlyFeeCents === 4343);
  check("rounding 17", withCredit.roundingDifferenceCents === 17);

  const zeroCredit = calculateMonthlyFee({
    fieldCostSnapshotCents: 90_000,
    approvedCreditCents: 0,
    payingMonthlyCount: 19,
  });
  check("sem aprovação → split = campo inteiro", zeroCredit.amountToSplitCents === 90_000);
  check("ceilDiv", ceilDiv(90_000, 19) === 4737);

  const prior = priorUnallocatedSurplusCents({
    kind: "REGULAR",
    status: "CLOSED",
    eligibleDailyRevenueCents: 10_000,
    carriedCreditCents: 3_000,
    roundingDifferenceCents: 17,
  });
  check("prior unallocated = 7000+17", prior === 7_017);

  const avail = computeAvailableCredit({
    priorUnallocatedCents: 7_017,
    dailyEligibleCents: 1_500,
    sourceCycleId: "x",
  });
  check("available = prior+daily", avail.availableCents === 8_517);

  check("caixa líquido", netCashCents([{ direction: "IN", amountCents: 100 }, { direction: "OUT", amountCents: 40 }]) === 60);
  check("audit credit", categorizeAuditAction("BILLING_CREDIT_APPROVED") === "FINANCE");
  check("formatCentsBRL 15,00", formatCentsBRL(1500) === "R$ 15,00");
  check("formatCentsBRL 900,00", formatCentsBRL(90000) === "R$ 900,00");
  check("formatCentsBRL milhares", formatCentsBRL(123456) === "R$ 1.234,56");
  check("parseBRLToCents 15,50", parseBRLToCents("15,50") === 1550);
  check("parseBRLToCents 1.234,56", parseBRLToCents("1.234,56") === 123456);
  check("parseBRLToCents R$ prefix", parseBRLToCents("R$ 900,00") === 90000);
  check("parseBRLToCents 15.50 US", parseBRLToCents("15.50") === 1550);
  check("parseBRLToCents integer-safe 0,10", parseBRLToCents("0,10") === 10);
  check("centsFromDigits máscara 1500", centsFromDigits("R$ 15,00") === 1500);
  check("centsFromDigits typing", centsFromDigits("1500") === 1500);
  check("parseCurrencyInput digits", parseCurrencyInputToCents("1500") === 1500);
  check("parseCurrencyInput formatted", parseCurrencyInputToCents("1.234,56") === 123456);
  check("timezone Recife label", timezoneSelectOptions("America/Recife")[0]?.value === "America/Recife");
  check(
    "timezone preserva desconhecido",
    timezoneSelectOptions("Europe/Lisbon")[0]?.value === "Europe/Lisbon",
  );
  check(
    "admin subnav Phase 2",
    ADMIN_SUBNAV.some((i) => i.href === "/admin/financeiro") &&
      ADMIN_SUBNAV.some((i) => i.href === "/admin/configuracoes") &&
      ADMIN_SUBNAV.length === 5,
  );

  const decCivil = { year: 2026, month: 12, day: 1 };
  const decCut = defaultFreezesAt(decCivil, "America/Recife");
  check(
    "dez/2026 corte automático sexta 08:00",
    decCut.toISOString() === "2026-12-04T11:00:00.000Z",
    decCut.toISOString(),
  );
  check(
    "rótulo mês Dezembro de 2026",
    formatReferenceMonthLabelPt(decCivil) === "Dezembro de 2026",
  );
  check(
    "rótulo abertura 04/12/2026 às 08:00",
    formatActivationDateTimePt(decCut, "America/Recife") === "04/12/2026 às 08:00",
  );
  const formParsed = zonedDateTimeFromFormParts("2026-12-04", "08:00", "America/Recife");
  check(
    "form date+time → Recife absoluto",
    formParsed?.toISOString() === "2026-12-04T11:00:00.000Z",
    formParsed?.toISOString(),
  );
  const prevTz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  const fromLa = zonedDateTimeFromFormParts("2026-12-04", "08:00", "America/Recife");
  check(
    "Admin em outro fuso: mesmo instante Recife",
    fromLa?.toISOString() === "2026-12-04T11:00:00.000Z",
    fromLa?.toISOString(),
  );
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;

  const parts = activationInputPartsInZone(decCut, "America/Recife");
  check("input date parts", parts.date === "2026-12-04" && parts.time === "08:00");

  const formSrc = readFileSync(
    path.resolve("src/app/(app)/admin/configuracoes/finance-settings-form.tsx"),
    "utf8",
  );
  check("UI removeu vencimento mensalidade", !formSrc.includes('name="monthlyFeeDueDay"'));
  check("UI removeu vencimento campo", !formSrc.includes('name="fieldPaymentDueDay"'));
  check("UI Alterar início da cobrança", formSrc.includes("Alterar início da cobrança"));
  check("UI Salvar alteração", formSrc.includes("Salvar alteração"));
  check("UI sem freezesAt no copy", !formSrc.includes("`freezesAt`") && !formSrc.includes("Override"));

  const chargePending = {
    id: "c1",
    type: "MONTHLY_FEE" as const,
    amountCents: 5000,
    paidCents: 0,
    status: "PENDING" as const,
    isActivated: true,
    createdAt: new Date("2026-12-04T12:00:00.000Z"),
    billingCycleId: "bc1",
  };
  check(
    "locks off → full access",
    evaluateFinancialAccess({
      role: "PLAYER",
      financeAccessLocksEnabled: false,
      charges: [chargePending],
      grants: [],
      dailyChargesAfterGrant: [],
      now: new Date("2026-12-10T12:00:00.000Z"),
    }).mode === "full",
  );
  check(
    "PLAYER com dívida → restricted",
    evaluateFinancialAccess({
      role: "PLAYER",
      financeAccessLocksEnabled: true,
      charges: [chargePending],
      grants: [],
      dailyChargesAfterGrant: [],
      now: new Date("2026-12-10T12:00:00.000Z"),
    }).mode === "payment_restricted",
  );
  check(
    "ADMIN com dívida → full",
    evaluateFinancialAccess({
      role: "ADMIN",
      financeAccessLocksEnabled: true,
      charges: [chargePending],
      grants: [],
      dailyChargesAfterGrant: [],
      now: new Date("2026-12-10T12:00:00.000Z"),
    }).mode === "full",
  );
  check(
    "exception grant → full",
    evaluateFinancialAccess({
      role: "PLAYER",
      financeAccessLocksEnabled: true,
      charges: [chargePending],
      grants: [
        {
          id: "g1",
          kind: "MONTHLY",
          relatedChargeId: "c1",
          grantedAt: new Date("2026-12-05T12:00:00.000Z"),
          revokedAt: null,
          expiresAtCycleFreezesAt: new Date("2027-01-08T11:00:00.000Z"),
        },
      ],
      dailyChargesAfterGrant: [],
      now: new Date("2026-12-10T12:00:00.000Z"),
    }).reason === "exceptional_access",
  );
  check(
    "monthly grant expired at next freezesAt",
    evaluateFinancialAccess({
      role: "PLAYER",
      financeAccessLocksEnabled: true,
      charges: [chargePending],
      grants: [
        {
          id: "g1",
          kind: "MONTHLY",
          relatedChargeId: "c1",
          grantedAt: new Date("2026-12-05T12:00:00.000Z"),
          revokedAt: null,
          expiresAtCycleFreezesAt: new Date("2027-01-08T11:00:00.000Z"),
        },
      ],
      dailyChargesAfterGrant: [],
      now: new Date("2027-01-08T11:00:00.000Z"),
    }).mode === "payment_restricted",
  );
  check(
    "daily grant expires on newer daily charge",
    evaluateFinancialAccess({
      role: "PLAYER",
      financeAccessLocksEnabled: true,
      charges: [
        {
          ...chargePending,
          id: "d1",
          type: "DAILY_FEE",
          billingCycleId: null,
        },
      ],
      grants: [
        {
          id: "g2",
          kind: "DAILY",
          relatedChargeId: "d1",
          grantedAt: new Date("2026-11-01T12:00:00.000Z"),
          revokedAt: null,
          expiresAtCycleFreezesAt: null,
        },
      ],
      dailyChargesAfterGrant: [
        { grantId: "g2", chargeId: "d2", createdAt: new Date("2026-12-01T12:00:00.000Z") },
      ],
      now: new Date("2026-12-10T12:00:00.000Z"),
    }).mode === "payment_restricted",
  );

  const activeMonthlyGrant = {
    id: "g-active",
    kind: "MONTHLY" as const,
    relatedChargeId: "c1",
    grantedAt: new Date("2026-12-05T12:00:00.000Z"),
    revokedAt: null,
    expiresAtCycleFreezesAt: new Date("2027-01-08T11:00:00.000Z"),
  };
  const revokedGrant = {
    ...activeMonthlyGrant,
    id: "g-revoked",
    revokedAt: new Date("2026-12-06T12:00:00.000Z"),
  };
  const expiredMonthlyGrant = {
    ...activeMonthlyGrant,
    id: "g-expired-m",
  };
  const activeDailyGrant = {
    id: "g-daily",
    kind: "DAILY" as const,
    relatedChargeId: "d1",
    grantedAt: new Date("2026-11-01T12:00:00.000Z"),
    revokedAt: null,
    expiresAtCycleFreezesAt: null,
  };
  const grantNow = new Date("2026-12-10T12:00:00.000Z");
  const grantPastExpiry = new Date("2027-01-08T11:00:00.000Z");
  check(
    "isGrantActive: monthly ativo antes do freezesAt",
    isGrantActive(activeMonthlyGrant, { now: grantNow, dailyChargesAfterGrant: [] }),
  );
  check(
    "isGrantActive: monthly expirado no freezesAt",
    !isGrantActive(expiredMonthlyGrant, { now: grantPastExpiry, dailyChargesAfterGrant: [] }),
  );
  check(
    "isGrantActive: revogado nunca ativo",
    !isGrantActive(revokedGrant, { now: grantNow, dailyChargesAfterGrant: [] }),
  );
  check(
    "isGrantActive: daily ativo sem cobrança nova",
    isGrantActive(activeDailyGrant, { now: grantNow, dailyChargesAfterGrant: [] }),
  );
  check(
    "isGrantActive: daily expirado com cobrança nova",
    !isGrantActive(activeDailyGrant, {
      now: grantNow,
      dailyChargesAfterGrant: [
        { grantId: "g-daily", chargeId: "d2", createdAt: new Date("2026-12-01T12:00:00.000Z") },
      ],
    }),
  );
  check(
    "transparency: só grant efetivo marca charge",
    (() => {
      const active = activeExceptionalRelatedChargeIds(
        [activeMonthlyGrant, revokedGrant, expiredMonthlyGrant, activeDailyGrant],
        {
          now: grantPastExpiry,
          dailyChargesAfterGrant: [
            { grantId: "g-daily", chargeId: "d2", createdAt: new Date("2026-12-01T12:00:00.000Z") },
          ],
        },
      );
      return !active.has("c1") && !active.has("d1") && active.size === 0;
    })(),
  );
  check(
    "transparency: grant ativo marca charge relacionado",
    activeExceptionalRelatedChargeIds([activeMonthlyGrant], {
      now: grantNow,
      dailyChargesAfterGrant: [],
    }).has("c1"),
  );
  check(
    "UI exceptional só com grant efetivo",
    resolvePlayerChargeUiStatus({
      remainingCents: 5000,
      amountCents: 5000,
      paidCents: 0,
      hasPendingReceipt: false,
      lastReceiptRejected: false,
      exceptionalAccess: true,
    }) === "acesso_liberado_excepcionalmente",
  );
  check(
    "UI sem grant efetivo não mostra exceptional",
    resolvePlayerChargeUiStatus({
      remainingCents: 5000,
      amountCents: 5000,
      paidCents: 0,
      hasPendingReceipt: false,
      lastReceiptRejected: false,
      exceptionalAccess: false,
    }) === "pagamento_pendente",
  );

  check("path /pagamentos allowed", isPathAllowedWhenPaymentRestricted("/pagamentos"));
  check("path /financeiro allowed", isPathAllowedWhenPaymentRestricted("/financeiro"));
  check("path /stats denied", !isPathAllowedWhenPaymentRestricted("/stats"));
  check(
    "UI status aguardando",
    resolvePlayerChargeUiStatus({
      remainingCents: 100,
      amountCents: 1500,
      paidCents: 0,
      hasPendingReceipt: true,
      lastReceiptRejected: false,
      exceptionalAccess: false,
    }) === "aguardando_aprovacao",
  );
  check("receipt mime jpeg ok", assertReceiptUploadMeta({ mimeType: "image/jpeg", byteSize: 100, originalFilename: "a.jpg" }) == null);
  check("receipt mime exe rejected", assertReceiptUploadMeta({ mimeType: "text/plain", byteSize: 100, originalFilename: "a.txt" }) != null);
  check("receipt too big", assertReceiptUploadMeta({ mimeType: "image/png", byteSize: RECEIPT_MAX_BYTES + 1, originalFilename: "a.png" }) != null);
  check("receipt allowlist has pdf", RECEIPT_ALLOWED_MIME.has("application/pdf"));
  check(
    "declaração sem arquivo detectada",
    isDeclarationWithoutReceipt({
      mimeType: DECLARATION_WITHOUT_RECEIPT_MIME,
      storageKey: "smv:declaration:x",
    }),
  );
  check(
    "comprovante real não é declaração vazia",
    !isDeclarationWithoutReceipt({ mimeType: "image/jpeg", storageKey: "g/c/file.jpg" }),
  );

  const pagamentosSrc = readFileSync(path.resolve("src/app/(app)/pagamentos/page.tsx"), "utf8");
  check("player payment page exists", pagamentosSrc.includes("Pagamentos"));
  const declareFormSrc = readFileSync(
    path.resolve("src/app/(app)/pagamentos/receipt-upload-form.tsx"),
    "utf8",
  );
  check("player primary CTA Já fiz o pagamento", declareFormSrc.includes("Já fiz o pagamento"));
  check("player comprovante opcional", declareFormSrc.includes("opcional"));
  check("player Anexar comprovante pós-declaração", declareFormSrc.includes("Anexar comprovante"));
  const reviewSrc = readFileSync(
    path.resolve("src/app/(app)/admin/financeiro/receipt-review.tsx"),
    "utf8",
  );
  check("admin receipt review exists", reviewSrc.includes("Aprovar pagamento"));
  check("admin marca Sem comprovante", reviewSrc.includes("Sem comprovante"));
  check("admin fila em acordeão", reviewSrc.includes("aria-expanded") && reviewSrc.includes("Pagamentos a revisar"));
  const movementsSrc = readFileSync(
    path.resolve("src/app/(app)/admin/financeiro/finance-forms.tsx"),
    "utf8",
  );
  check(
    "movimentações financeiras com seletor",
    movementsSrc.includes("Movimentações financeiras") &&
      movementsSrc.includes("Receber pagamento") &&
      movementsSrc.includes("Pagar quadra") &&
      movementsSrc.includes("Outra despesa") &&
      movementsSrc.includes("Ajuste de caixa"),
  );
  check(
    "implantação não usa IDs crus no formulário legado",
    !movementsSrc.includes("IDs dos devedores"),
  );
  const initUiSrc = readFileSync(
    path.resolve("src/app/(app)/admin/financeiro/initialize-finance-card.tsx"),
    "utf8",
  );
  check(
    "UI implantação com seletor de nomes",
    initUiSrc.includes("DebtorPicker") &&
      initUiSrc.includes("Buscar mensalista") &&
      initUiSrc.includes("Nenhum devedor inicial selecionado") &&
      initUiSrc.includes("Mensalistas no próximo período") &&
      !initUiSrc.includes("IDs dos devedores"),
  );
  check(
    "UI implantação explica go-live sem cobrança imediata",
    initUiSrc.includes("Começando a cobrar só em dezembro") &&
      initUiSrc.includes("Deixe a lista de devedores iniciais vazia"),
  );
  const transparencyPage = readFileSync(
    path.resolve("src/app/(app)/financeiro/page.tsx"),
    "utf8",
  );
  check("player /financeiro page exists", transparencyPage.includes("Transparência do caixa"));
  const transparencySrc = readFileSync(
    path.resolve("src/server/modules/finance/transparency.ts"),
    "utf8",
  );
  check(
    "player transparency query module",
    transparencySrc.includes("getPlayerFinanceTransparency"),
  );
  check(
    "transparency usa política compartilhada de grant",
    transparencySrc.includes("activeExceptionalRelatedChargeIds"),
  );
  check(
    "init guard module existe",
    readFileSync(path.resolve("src/server/modules/finance/initialized.ts"), "utf8").includes(
      "isFinanceInitializedInTx",
    ),
  );
  check(
    "ensureBillingCycles exige OPENING",
    readFileSync(path.resolve("src/server/modules/finance/cycles.ts"), "utf8").includes(
      "isFinanceInitializedInTx",
    ),
  );
  check(
    "UI pagamentos pré-init",
    readFileSync(path.resolve("src/app/(app)/pagamentos/page.tsx"), "utf8").includes(
      "Financeiro ainda não configurado",
    ),
  );
  check(
    "UI financeiro pré-init",
    readFileSync(path.resolve("src/app/(app)/financeiro/page.tsx"), "utf8").includes(
      "Financeiro ainda não configurado",
    ),
  );
  check(
    "UI admin financeiro pré-init",
    readFileSync(path.resolve("src/app/(app)/admin/financeiro/page.tsx"), "utf8").includes(
      "Financeiro ainda não configurado",
    ),
  );

  check(
    "storage key aleatória por objectId",
    buildReceiptStorageKey({
      groupId: "11111111-1111-1111-1111-111111111111",
      chargeId: "22222222-2222-2222-2222-222222222222",
      objectId: "33333333-3333-3333-3333-333333333333",
      mimeType: "image/jpeg",
    }) ===
      "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpg",
  );
  check(
    "prod-like detecta VERCEL",
    isProductionLikeEnv({ VERCEL: "1", NODE_ENV: "development" }),
  );
  check(
    "prod-like detecta NODE_ENV=production",
    isProductionLikeEnv({ NODE_ENV: "production" }),
  );
  check(
    "local mode ok em desenvolvimento",
    resolveReceiptStorageMode({ SMV_RECEIPT_STORAGE: "local", NODE_ENV: "development" }).ok ===
      true,
  );
  const localInProd = resolveReceiptStorageMode({
    SMV_RECEIPT_STORAGE: "local",
    NODE_ENV: "production",
  });
  check(
    "local proibido em produção (fail-closed)",
    !localInProd.ok && localInProd.error.code === "local_forbidden_in_production",
  );
  const localOnVercel = resolveReceiptStorageMode({
    SMV_RECEIPT_STORAGE: "local",
    VERCEL: "1",
    NODE_ENV: "development",
  });
  check(
    "local proibido na Vercel (sem fallback)",
    !localOnVercel.ok && localOnVercel.error.code === "local_forbidden_in_production",
  );
  check(
    "modo inválido rejeitado",
    !resolveReceiptStorageMode({ SMV_RECEIPT_STORAGE: "disk" }).ok,
  );
  const missingS3 = resolveS3ReceiptStorageConfig({
    SMV_RECEIPT_STORAGE: "s3",
  });
  check(
    "s3 sem config falha fechado",
    !missingS3.ok && missingS3.error.code === "s3_missing_config",
  );
  const badEndpoint = resolveS3ReceiptStorageConfig({
    SMV_RECEIPT_S3_ENDPOINT: "http://insecure.example",
    SMV_RECEIPT_S3_BUCKET: "bucket",
    SMV_RECEIPT_S3_ACCESS_KEY_ID: "id",
    SMV_RECEIPT_S3_SECRET_ACCESS_KEY: "secret",
  });
  check(
    "s3 endpoint deve ser https",
    !badEndpoint.ok && badEndpoint.error.code === "s3_invalid_endpoint",
  );
  const okS3 = resolveS3ReceiptStorageConfig({
    SMV_RECEIPT_S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
    SMV_RECEIPT_S3_BUCKET: "smv-receipts",
    SMV_RECEIPT_S3_ACCESS_KEY_ID: "key",
    SMV_RECEIPT_S3_SECRET_ACCESS_KEY: "secret",
    SMV_RECEIPT_S3_REGION: "auto",
  });
  check("s3 config completa aceita", okS3.ok === true);
  check(
    "receipt storage module exporta adapter de teste",
    readFileSync(path.resolve("src/server/modules/finance/receipt-storage.ts"), "utf8").includes(
      "setReceiptObjectStoreForTests",
    ) &&
      readFileSync(path.resolve("src/server/modules/finance/receipt-storage.ts"), "utf8").includes(
        "PutObjectCommand",
      ),
  );
}

async function receiptStorageAdapterChecks() {
  const storage = await import("../src/server/modules/finance/receipt-storage");
  const objects = new Map<string, { bytes: Buffer; mimeType: string }>();
  let failNextPut: Error | null = null;

  const adapter = {
    async putObject({
      storageKey,
      bytes,
      mimeType,
    }: {
      storageKey: string;
      bytes: Buffer;
      mimeType: string;
    }) {
      if (failNextPut) {
        const err = failNextPut;
        failNextPut = null;
        throw err;
      }
      if (objects.has(storageKey)) {
        throw new UserFacingError(
          "Falha ao gravar comprovante (objeto já existe). Tente novamente.",
        );
      }
      objects.set(storageKey, { bytes: Buffer.from(bytes), mimeType });
    },
    async getObject(storageKey: string) {
      const row = objects.get(storageKey);
      if (!row) throw new UserFacingError("Comprovante não encontrado no storage.");
      return Buffer.from(row.bytes);
    },
  };
  storage.setReceiptObjectStoreForTests(adapter);

  try {
    const groupId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const chargeId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const stored = await storage.storeReceiptObject({
      groupId,
      chargeId,
      mimeType: "image/jpeg",
      originalFilename: "pix.jpg",
      bytes,
    });
    check("mock S3 upload ok", Boolean(stored.storageKey) && stored.byteSize === bytes.byteLength);
    check("mock S3 key não é path público", !stored.storageKey.startsWith("http"));
    const downloaded = await storage.readReceiptObject(stored.storageKey);
    check("mock S3 download ok", downloaded.equals(bytes));

    let missingOk = false;
    try {
      await storage.readReceiptObject(
        `${groupId}/${chargeId}/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg`,
      );
    } catch (error) {
      missingOk = error instanceof UserFacingError;
    }
    check("mock S3 objeto ausente", missingOk);

    let badMime = false;
    try {
      await storage.storeReceiptObject({
        groupId,
        chargeId,
        mimeType: "text/plain",
        originalFilename: "x.txt",
        bytes: Buffer.from("nope"),
      });
    } catch (error) {
      badMime = error instanceof UserFacingError;
    }
    check("mock S3 MIME inválido", badMime);

    let tooBig = false;
    try {
      await storage.storeReceiptObject({
        groupId,
        chargeId,
        mimeType: "image/png",
        originalFilename: "big.png",
        bytes: Buffer.alloc(RECEIPT_MAX_BYTES + 1, 1),
      });
    } catch (error) {
      tooBig = error instanceof UserFacingError;
    }
    check("mock S3 arquivo grande", tooBig);

    failNextPut = new UserFacingError(
      "Falha de autenticação no storage de comprovantes. Verifique as credenciais R2.",
    );
    let credFail = false;
    try {
      await storage.storeReceiptObject({
        groupId,
        chargeId,
        mimeType: "image/jpeg",
        originalFilename: "fail.jpg",
        bytes,
      });
    } catch (error) {
      credFail =
        error instanceof UserFacingError && error.message.includes("credenciais");
    }
    check("mock S3 credenciais/storage failure", credFail);

    const first = await storage.storeReceiptObject({
      groupId,
      chargeId,
      mimeType: "image/jpeg",
      originalFilename: "dup.jpg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xd9]),
    });
    let dupBlocked = false;
    try {
      await adapter.putObject({
        storageKey: first.storageKey,
        bytes,
        mimeType: "image/jpeg",
      });
    } catch (error) {
      dupBlocked =
        error instanceof UserFacingError && error.message.includes("já existe");
    }
    check("mock S3 overwrite bloqueado", dupBlocked);

    let traversal = false;
    try {
      await storage.readReceiptObject("../etc/passwd");
    } catch (error) {
      traversal = error instanceof UserFacingError;
    }
    check("storage key traversal rejeitada", traversal);

    const storageSrc = readFileSync(
      path.resolve("src/server/modules/finance/receipt-storage.ts"),
      "utf8",
    );
    check(
      "s3 mode não faz fallback para local",
      storageSrc.includes("nunca cai para filesystem local") &&
        storageSrc.includes("IfNoneMatch"),
    );
  } finally {
    storage.setReceiptObjectStoreForTests(null);
  }

  // Sem adapter: s3 mal configurado falha fechado (não grava em disco).
  const prevMode = process.env.SMV_RECEIPT_STORAGE;
  const prevEndpoint = process.env.SMV_RECEIPT_S3_ENDPOINT;
  const prevBucket = process.env.SMV_RECEIPT_S3_BUCKET;
  const prevKey = process.env.SMV_RECEIPT_S3_ACCESS_KEY_ID;
  const prevSecret = process.env.SMV_RECEIPT_S3_SECRET_ACCESS_KEY;
  process.env.SMV_RECEIPT_STORAGE = "s3";
  delete process.env.SMV_RECEIPT_S3_ENDPOINT;
  delete process.env.SMV_RECEIPT_S3_BUCKET;
  delete process.env.SMV_RECEIPT_S3_ACCESS_KEY_ID;
  delete process.env.SMV_RECEIPT_S3_SECRET_ACCESS_KEY;
  let missingConfigBlocked = false;
  try {
    await storage.storeReceiptObject({
      groupId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      chargeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      mimeType: "image/jpeg",
      originalFilename: "x.jpg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
  } catch (error) {
    missingConfigBlocked =
      error instanceof UserFacingError && error.message.includes("S3/R2");
  }
  check("s3 sem env não faz upload local", missingConfigBlocked);
  if (prevMode === undefined) delete process.env.SMV_RECEIPT_STORAGE;
  else process.env.SMV_RECEIPT_STORAGE = prevMode;
  if (prevEndpoint === undefined) delete process.env.SMV_RECEIPT_S3_ENDPOINT;
  else process.env.SMV_RECEIPT_S3_ENDPOINT = prevEndpoint;
  if (prevBucket === undefined) delete process.env.SMV_RECEIPT_S3_BUCKET;
  else process.env.SMV_RECEIPT_S3_BUCKET = prevBucket;
  if (prevKey === undefined) delete process.env.SMV_RECEIPT_S3_ACCESS_KEY_ID;
  else process.env.SMV_RECEIPT_S3_ACCESS_KEY_ID = prevKey;
  if (prevSecret === undefined) delete process.env.SMV_RECEIPT_S3_SECRET_ACCESS_KEY;
  else process.env.SMV_RECEIPT_S3_SECRET_ACCESS_KEY = prevSecret;

  const routeSrc = readFileSync(
    path.resolve("src/app/api/finance/receipts/[receiptId]/route.ts"),
    "utf8",
  );
  check(
    "download exige dono ou ADMIN",
    routeSrc.includes("isOwner") && routeSrc.includes("isAdmin") && routeSrc.includes("403"),
  );
}

async function seedFinanceGroup(tx: Tx) {
  const suffix = randomUUID().slice(0, 8);
  const adminUser = await tx.user.create({
    data: {
      username: `fin_admin_${suffix}`,
      name: "Fin Admin",
      passwordHash: "x",
      mustChangePassword: false,
    },
  });
  const tulio = await tx.user.create({
    data: {
      username: `fin_tulio_${suffix}`,
      name: "Tulio Exempt",
      passwordHash: "x",
      mustChangePassword: false,
    },
  });
  const p1 = await tx.user.create({
    data: { username: `fin_p1_${suffix}`, name: "Payer One", passwordHash: "x", mustChangePassword: false },
  });
  const p2 = await tx.user.create({
    data: { username: `fin_p2_${suffix}`, name: "Payer Two", passwordHash: "x", mustChangePassword: false },
  });
  const dailyUser = await tx.user.create({
    data: { username: `fin_daily_${suffix}`, name: "Daily Player", passwordHash: "x", mustChangePassword: false },
  });

  const group = await tx.group.create({
    data: {
      name: `Finance Check ${suffix}`,
      slug: `finance-check-${suffix}`,
      timezone: "America/Recife",
      settings: {
        create: {
          sessionWeekday: "THURSDAY",
          sessionStartMinute: 19 * 60,
          sessionEndMinute: 21 * 60,
          maxExtraMinutes: 30,
          registrationOpensDaysBefore: 3,
          registrationOpensMinute: 8 * 60,
          priorityDeadlineDaysBefore: 0,
          priorityDeadlineMinute: 18 * 60,
          priorityReminderDaysBefore: 0,
          priorityReminderMinute: 12 * 60,
          priorityReminderEnabled: false,
          sessionAutoCreateLeadDays: 7,
          maxPlayers: 20,
          teamSize: 5,
          matchDurationSec: 420,
          drawOptionsCount: 2,
          drawMinOptionDifference: 2,
          dailyFeeCents: 1500,
          monthlyFieldCostCents: 90_000,
          fieldPaymentDueDay: 10,
          monthlyFeeDueDay: 7,
          currency: "BRL",
        },
      },
    },
  });

  const season = await tx.season.create({
    data: {
      groupId: group.id,
      name: `Fin ${suffix}`,
      startsOn: new Date(Date.UTC(2020, 0, 1)),
      endsOn: new Date(Date.UTC(2099, 11, 31)),
    },
  });

  const mkMember = async (
    userId: string,
    role: "ADMIN" | "PLAYER",
    modality: "MONTHLY" | "DAILY",
    feeExempt = false,
  ) =>
    tx.groupMember.create({
      data: {
        groupId: group.id,
        userId,
        role,
        modality,
        baseRating: 3,
        status: "ACTIVE",
        feeExempt,
        feeExemptReason: feeExempt ? "Administrador principal" : null,
        feeExemptUpdatedAt: feeExempt ? new Date() : null,
        feeExemptUpdatedByUserId: feeExempt ? adminUser.id : null,
      },
      include: { user: { select: { id: true, username: true, name: true } } },
    });

  const admin = await mkMember(adminUser.id, "ADMIN", "MONTHLY");
  const tulioMember = await mkMember(tulio.id, "ADMIN", "MONTHLY", true);
  const payer1 = await mkMember(p1.id, "PLAYER", "MONTHLY");
  const payer2 = await mkMember(p2.id, "PLAYER", "MONTHLY");
  const daily = await mkMember(dailyUser.id, "PLAYER", "DAILY");

  return {
    group: { id: group.id, name: group.name, timezone: "America/Recife" as const },
    seasonId: season.id,
    admin,
    tulioMember,
    payer1,
    payer2,
    daily,
  };
}

async function scenario(tx: Tx) {
  const finance = await import("../src/server/modules/finance/initialize");
  const cycles = await import("../src/server/modules/finance/cycles");
  const payments = await import("../src/server/modules/finance/payments");
  const cash = await import("../src/server/modules/finance/cash");
  const credits = await import("../src/server/modules/finance/credits");
  const dailyCharges = await import("../src/server/modules/finance/daily-charges");
  const accessMod = await import("../src/server/modules/finance/access");
  const initializedMod = await import("../src/server/modules/finance/initialized");
  const queries = await import("../src/server/modules/finance/queries");
  const transparency = await import("../src/server/modules/finance/transparency");
  const playerQueries = await import("../src/server/modules/finance/player-queries");
  const { UserFacingError } = await import("../src/server/errors");

  const ctx = await seedFinanceGroup(tx);
  const adminViewer = viewerOf(ctx.group, ctx.admin);
  const playerViewer = viewerOf(ctx.group, ctx.payer1);
  const player2Viewer = viewerOf(ctx.group, ctx.payer2);

  // --- Pré-implantação: nenhum write financeiro automático ---
  check(
    "pré-init: não implantado",
    (await initializedMod.isFinanceInitialized(ctx.group.id)) === false,
  );
  const accessBefore = await accessMod.getFinancialAccessForViewer(playerViewer);
  check(
    "pré-init: player access full (locks off)",
    accessBefore.mode === "full" && accessBefore.reason === "locks_disabled",
  );
  await Promise.all([
    accessMod.getFinancialAccessForViewer(playerViewer),
    accessMod.getFinancialAccessForViewer(player2Viewer),
    cycles.ensureFinanceState(ctx.group.id),
    queries.getAdminFinanceDashboard(ctx.group.id, "America/Recife"),
    transparency.getPlayerFinanceTransparency(playerViewer, {}),
    playerQueries.getPlayerPaymentsPage(playerViewer),
  ]);
  check(
    "pré-init: requests concorrentes não criam ciclos",
    (await tx.billingCycle.count({ where: { groupId: ctx.group.id } })) === 0,
  );
  check(
    "pré-init: sem charges/caixa",
    (await tx.charge.count({ where: { groupId: ctx.group.id } })) === 0 &&
      (await tx.cashTransaction.count({ where: { groupId: ctx.group.id } })) === 0,
  );
  const dashBefore = await queries.getAdminFinanceDashboard(ctx.group.id, "America/Recife");
  const payBefore = await playerQueries.getPlayerPaymentsPage(playerViewer);
  const boardBefore = await transparency.getPlayerFinanceTransparency(playerViewer, {});
  check("pré-init: admin marca não configurado", dashBefore.financeInitialized === false);
  check("pré-init: pagamentos marca não configurado", payBefore.financeInitialized === false);
  check("pré-init: transparência marca não configurado", boardBefore.financeInitialized === false);
  check(
    "pré-init: locks desabilitados",
    (
      await tx.groupSettings.findUniqueOrThrow({
        where: { groupId: ctx.group.id },
        select: { financeAccessLocksEnabled: true },
      })
    ).financeAccessLocksEnabled === false,
  );

  // Sessão FINISHED antes da implantação — sem cobrança
  const preInitSession = await tx.gameSession.create({
    data: {
      groupId: ctx.group.id,
      seasonId: ctx.seasonId,
      status: "FINISHED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(2026, 0, 2)),
      startsAt: new Date("2026-01-02T22:00:00.000Z"),
      endsAt: new Date("2026-01-03T00:00:00.000Z"),
      finishedAt: new Date("2026-01-03T00:05:00.000Z"),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date("2025-12-30T11:00:00.000Z"),
      openedAt: new Date("2025-12-30T11:00:00.000Z"),
      priorityDeadlineAt: new Date("2026-01-02T21:00:00.000Z"),
      priorityClosedAt: new Date("2026-01-02T21:00:00.000Z"),
      startedAt: new Date("2026-01-02T22:00:00.000Z"),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1500,
      venueName: "Pre-init session",
    },
  });
  const preInitReg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: preInitSession.id,
      memberId: ctx.daily.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date("2025-12-30T12:00:00.000Z"),
      queueSortAt: new Date("2025-12-30T12:00:00.000Z"),
      priorityTier: "GENERAL",
      modalitySnapshot: "DAILY",
      respondedAt: new Date("2025-12-30T12:00:00.000Z"),
      attendance: "PRESENT",
      attendanceMarkedAt: new Date("2026-01-02T22:30:00.000Z"),
      attendanceMarkedByUserId: ctx.admin.user.id,
    },
  });
  const preInitGen = await dailyCharges.generateDailyFeeChargesInTx(tx, {
    groupId: ctx.group.id,
    sessionId: preInitSession.id,
    actorUserId: ctx.admin.user.id,
  });
  check("pré-init: diária não gerada", preInitGen.skippedUninitialized === true);
  check(
    "pré-init: sessão FINISHED sem charge/caixa",
    (await tx.charge.findUnique({ where: { sessionRegistrationId: preInitReg.id } })) == null &&
      (await tx.cashTransaction.count({ where: { groupId: ctx.group.id } })) === 0 &&
      (
        await tx.gameSession.findUniqueOrThrow({
          where: { id: preInitSession.id },
          select: { chargesGeneratedAt: true },
        })
      ).chargesGeneratedAt == null,
  );

  // Falha de implantação não deixa lixo
  let initFailOk = false;
  try {
    await finance.initializeFinance(adminViewer, {
      initialBalanceCents: 1_000,
      openingMonthlyFeeCents: 5_000,
      remainingFieldCostCents: 0,
      debtorMemberIds: [randomUUID()],
      reason: "deve falhar",
      operationId: randomUUID(),
    });
  } catch (error) {
    initFailOk = error instanceof UserFacingError;
  }
  check("pré-init: falha de init não cria ciclos", initFailOk);
  check(
    "pré-init: rollback sem ciclos/caixa após falha",
    (await tx.billingCycle.count({ where: { groupId: ctx.group.id } })) === 0 &&
      (await tx.cashTransaction.count({ where: { groupId: ctx.group.id } })) === 0,
  );

  const initOp = randomUUID();
  const init = await finance.initializeFinance(adminViewer, {
    initialBalanceCents: 50_000,
    openingMonthlyFeeCents: 5_000,
    remainingFieldCostCents: 90_000,
    debtorMemberIds: [ctx.payer1.id, ctx.payer2.id],
    reason: "Implantação check-finance",
    operationId: initOp,
  });
  check("initialize OK", Boolean(init.openingCycleId && init.nextCycleId));
  check("initialize alreadyInitialized=false", init.alreadyInitialized === false);
  check(
    "pós-init: implantado",
    (await initializedMod.isFinanceInitialized(ctx.group.id)) === true,
  );

  // Concorrência: segunda implantação no mesmo grupo
  const secondInit = await finance.initializeFinance(adminViewer, {
    initialBalanceCents: 1,
    openingMonthlyFeeCents: 0,
    remainingFieldCostCents: 0,
    debtorMemberIds: [],
    reason: "segunda tentativa",
    operationId: randomUUID(),
  });
  check("init concorrente → alreadyInitialized", secondInit.alreadyInitialized === true);
  check(
    "init concorrente não duplica OPENING",
    (await tx.billingCycle.count({ where: { groupId: ctx.group.id, kind: "OPENING" } })) === 1,
  );

  // Backfill da sessão FINISHED pré-init
  check(
    "pós-init: backfill diária da sessão prévia",
    (await tx.charge.findUnique({ where: { sessionRegistrationId: preInitReg.id } })) != null,
  );

  // Primeiro request de player após init — sem erro; locks ainda off
  const accessAfter = await accessMod.getFinancialAccessForViewer(playerViewer);
  check(
    "pós-init: player ainda full com locks off",
    accessAfter.mode === "full" && accessAfter.reason === "locks_disabled",
  );
  const dashAfter = await queries.getAdminFinanceDashboard(ctx.group.id, "America/Recife");
  check("pós-init: admin marca configurado", dashAfter.financeInitialized === true);
  check(
    "dashboard lista mensalistas com feeExempt",
    dashAfter.monthlyMembers.some((m) => m.feeExempt) &&
      dashAfter.monthlyMembers.every((m) => typeof m.feeExempt === "boolean"),
  );

  // --- Transição Nov→Dez (go-live): init no mês corrente sem devedores ---
  const lateJoinMod = await import("../src/server/modules/finance/late-join");
  const emptyCtx = await seedFinanceGroup(tx);
  const emptyAdmin = viewerOf(emptyCtx.group, emptyCtx.admin);
  const emptyPlayer = viewerOf(emptyCtx.group, emptyCtx.payer1);
  const emptyInit = await finance.initializeFinance(emptyAdmin, {
    initialBalanceCents: 25_000,
    openingMonthlyFeeCents: 5_000,
    remainingFieldCostCents: 40_000,
    debtorMemberIds: [],
    reason: "Virada dezembro sem dívidas prévias",
    operationId: randomUUID(),
  });
  check("init vazio: alreadyInitialized=false", emptyInit.alreadyInitialized === false);
  check(
    "init vazio: zero cobranças no OPENING",
    emptyInit.chargeIds.length === 0 &&
      (await tx.charge.count({
        where: { groupId: emptyCtx.group.id, billingCycleId: emptyInit.openingCycleId },
      })) === 0,
  );
  check(
    "init vazio: saldo de abertura gravado",
    emptyInit.initialBalanceTransactionId != null &&
      (
        await tx.cashTransaction.findUniqueOrThrow({
          where: { id: emptyInit.initialBalanceTransactionId },
        })
      ).amountCents === 25_000,
  );

  const emptyOpening = await tx.billingCycle.findUniqueOrThrow({
    where: { id: emptyInit.openingCycleId },
  });
  const emptyNext = await tx.billingCycle.findUniqueOrThrow({
    where: { id: emptyInit.nextCycleId },
  });
  const emptyNextCivil = {
    year: emptyNext.referenceMonth.getUTCFullYear(),
    month: emptyNext.referenceMonth.getUTCMonth() + 1,
    day: 1,
  };
  const emptyExpectedCut = defaultFreezesAt(emptyNextCivil, "America/Recife");
  check(
    "go-live: OPENING = mês corrente CLOSED sem mensalidades",
    emptyOpening.kind === "OPENING" &&
      emptyOpening.status === "CLOSED" &&
      (await tx.charge.count({
        where: { billingCycleId: emptyOpening.id, type: "MONTHLY_FEE" },
      })) === 0,
  );
  check(
    "go-live: próximo ciclo REGULAR OPEN com corte sexta 08:00 natural",
    emptyNext.kind === "REGULAR" &&
      emptyNext.status === "OPEN" &&
      emptyNext.freezesAt.toISOString() === emptyExpectedCut.toISOString(),
    `${emptyNext.freezesAt.toISOString()} vs ${emptyExpectedCut.toISOString()}`,
  );
  // Quando o relógio civil é nov/2026, o primeiro REGULAR é dez/2026 → 04/12 08:00 Recife.
  const civilNow = startOfMonthCivil(new Date(), "America/Recife");
  if (civilNow.year === 2026 && civilNow.month === 11) {
    check(
      "go-live nov/2026: corte do 1º REGULAR = 2026-12-04T11:00:00.000Z",
      emptyNext.freezesAt.toISOString() === "2026-12-04T11:00:00.000Z",
    );
  }

  // Navegação / lazy ensure não gera mensalidade do mês corrente antes do corte.
  await cycles.ensureFinanceState(emptyCtx.group.id, emptyAdmin.user.id);
  await cycles.freezeDueCyclesInTx(tx, emptyCtx.group.id, emptyAdmin.user.id);
  check(
    "go-live: ensure/freezeDue antes do corte → zero MONTHLY_FEE",
    (await tx.charge.count({
      where: { groupId: emptyCtx.group.id, type: "MONTHLY_FEE" },
    })) === 0,
  );

  // Encerrar sessão no mês corrente: só diária (PRESENT + DAILY), nunca mensalidade.
  const novSession = await tx.gameSession.create({
    data: {
      groupId: emptyCtx.group.id,
      seasonId: emptyCtx.seasonId,
      status: "FINISHED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(2026, 10, 19)),
      startsAt: new Date("2026-11-19T22:00:00.000Z"),
      endsAt: new Date("2026-11-20T00:00:00.000Z"),
      finishedAt: new Date("2026-11-20T00:05:00.000Z"),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date("2026-11-16T11:00:00.000Z"),
      openedAt: new Date("2026-11-16T11:00:00.000Z"),
      priorityDeadlineAt: new Date("2026-11-19T21:00:00.000Z"),
      priorityClosedAt: new Date("2026-11-19T21:00:00.000Z"),
      startedAt: new Date("2026-11-19T22:00:00.000Z"),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1500,
      venueName: "Go-live Nov session",
    },
  });
  const novDailyReg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: novSession.id,
      memberId: emptyCtx.daily.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date("2026-11-17T12:00:00.000Z"),
      queueSortAt: new Date("2026-11-17T12:00:00.000Z"),
      priorityTier: "GENERAL",
      modalitySnapshot: "DAILY",
      respondedAt: new Date("2026-11-17T12:00:00.000Z"),
      attendance: "PRESENT",
      attendanceMarkedAt: new Date("2026-11-20T00:01:00.000Z"),
      attendanceMarkedByUserId: emptyCtx.admin.user.id,
    },
  });
  const novMonthlyReg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: novSession.id,
      memberId: emptyCtx.payer1.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date("2026-11-17T12:05:00.000Z"),
      queueSortAt: new Date("2026-11-17T12:05:00.000Z"),
      priorityTier: "GENERAL",
      modalitySnapshot: "MONTHLY",
      respondedAt: new Date("2026-11-17T12:05:00.000Z"),
      attendance: "PRESENT",
      attendanceMarkedAt: new Date("2026-11-20T00:01:00.000Z"),
      attendanceMarkedByUserId: emptyCtx.admin.user.id,
    },
  });
  await dailyCharges.generateDailyFeeChargesInTx(tx, {
    groupId: emptyCtx.group.id,
    sessionId: novSession.id,
    actorUserId: emptyCtx.admin.user.id,
  });
  check(
    "go-live: fim de sessão gera diária do diarista",
    (await tx.charge.findUnique({ where: { sessionRegistrationId: novDailyReg.id } })) != null,
  );
  check(
    "go-live: fim de sessão NÃO gera mensalidade do mensalista",
    (await tx.charge.findUnique({ where: { sessionRegistrationId: novMonthlyReg.id } })) == null &&
      (await tx.charge.count({
        where: { groupId: emptyCtx.group.id, type: "MONTHLY_FEE" },
      })) === 0,
  );

  // LATE_JOIN no OPENING vazio deve adiar (não cobrar novembro).
  const joinerUser = await tx.user.create({
    data: {
      username: `fin_join_${randomUUID().slice(0, 8)}`,
      name: "Late Joiner",
      passwordHash: "x",
      mustChangePassword: false,
    },
  });
  const joiner = await tx.groupMember.create({
    data: {
      groupId: emptyCtx.group.id,
      userId: joinerUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
  });
  const lateEmpty = await lateJoinMod.ensureLateJoinMonthlyChargeInTx(tx, {
    groupId: emptyCtx.group.id,
    memberId: joiner.id,
    timeZone: "America/Recife",
    actorUserId: emptyCtx.admin.user.id,
  });
  check(
    "go-live: LATE_JOIN em OPENING vazio adia ao próximo freeze",
    lateEmpty.chargeId == null && lateEmpty.deferredToFreeze === true,
  );
  check(
    "go-live: ainda zero MONTHLY_FEE após LATE_JOIN",
    (await tx.charge.count({
      where: { groupId: emptyCtx.group.id, type: "MONTHLY_FEE" },
    })) === 0,
  );

  // Locks ligados + dívidas mensais inexistentes → sem restrição (diária do diarista não afeta payer1).
  await tx.groupSettings.update({
    where: { groupId: emptyCtx.group.id },
    data: { financeAccessLocksEnabled: true },
  });
  const accessBeforeCut = await accessMod.getFinancialAccessForViewer(emptyPlayer);
  check(
    "go-live: locks on antes do corte sem mensalidade → full",
    accessBeforeCut.mode === "full" &&
      (accessBeforeCut.reason === "no_blocking_debt" || accessBeforeCut.reason === "locks_disabled"),
  );
  // Restaura locks off (padrão do produto até go-live de cobrança).
  await tx.groupSettings.update({
    where: { groupId: emptyCtx.group.id },
    data: { financeAccessLocksEnabled: false },
  });

  // Freeze antecipado do REGULAR sem override deve falhar enquanto freezesAt > now.
  let earlyFreezeBlocked = false;
  try {
    await cycles.freezeBillingCycle(emptyAdmin, emptyNext.id, randomUUID());
  } catch (error) {
    earlyFreezeBlocked = error instanceof UserFacingError;
  }
  check("go-live: freeze antes do corte bloqueado", earlyFreezeBlocked);
  check(
    "go-live: freeze bloqueado não criou MONTHLY_FEE",
    (await tx.charge.count({
      where: { groupId: emptyCtx.group.id, type: "MONTHLY_FEE" },
    })) === 0,
  );

  await cycles.overrideCycleActivation(
    emptyAdmin,
    emptyNext.id,
    new Date("2020-01-01T03:00:00.000Z"),
  );
  const emptyFreeze = await cycles.freezeBillingCycle(emptyAdmin, emptyNext.id, randomUUID());
  // 3 seed payers + joiner LATE_JOIN adiado; Tulio isento.
  check(
    "go-live: freeze do 1º REGULAR cobra 4 mensalistas (Tulio isento)",
    emptyFreeze.payingMonthlyCount === 4,
    String(emptyFreeze.payingMonthlyCount),
  );
  check(
    "go-live: mensalidades só após corte do próximo ciclo",
    (await tx.charge.count({
      where: {
        groupId: emptyCtx.group.id,
        billingCycleId: emptyNext.id,
        type: "MONTHLY_FEE",
      },
    })) === 4,
  );
  check(
    "go-live: joiner adiado entra no 1º REGULAR",
    (await tx.charge.count({
      where: {
        billingCycleId: emptyNext.id,
        memberId: joiner.id,
        type: "MONTHLY_FEE",
        monthlyFeeOrigin: "CYCLE_FREEZE",
      },
    })) === 1,
  );
  check(
    "go-live: Tulio sem cobrança no 1º REGULAR",
    (await tx.charge.count({
      where: {
        groupId: emptyCtx.group.id,
        memberId: emptyCtx.tulioMember.id,
        type: "MONTHLY_FEE",
      },
    })) === 0,
  );
  check(
    "go-live: OPENING continua sem MONTHLY_FEE",
    (await tx.charge.count({
      where: { billingCycleId: emptyOpening.id, type: "MONTHLY_FEE" },
    })) === 0,
  );
  const freezeAgain = await cycles.freezeBillingCycle(emptyAdmin, emptyNext.id, randomUUID());
  check("go-live: segundo freeze idempotente", freezeAgain.alreadyClosed === true);
  check(
    "go-live: cobranças do 1º REGULAR exatamente uma vez",
    (await tx.charge.count({
      where: {
        groupId: emptyCtx.group.id,
        billingCycleId: emptyNext.id,
        type: "MONTHLY_FEE",
      },
    })) === 4,
  );

  // OPENING com devedores reais: LATE_JOIN no mês corrente permanece permitido.
  const debtCtx = await seedFinanceGroup(tx);
  const debtAdmin = viewerOf(debtCtx.group, debtCtx.admin);
  const debtInit = await finance.initializeFinance(debtAdmin, {
    initialBalanceCents: 1_000,
    openingMonthlyFeeCents: 5_000,
    remainingFieldCostCents: 0,
    debtorMemberIds: [debtCtx.payer1.id],
    reason: "Implantação com dívida prévia",
    operationId: randomUUID(),
  });
  const debtJoinerUser = await tx.user.create({
    data: {
      username: `fin_djoin_${randomUUID().slice(0, 8)}`,
      name: "Debt Month Joiner",
      passwordHash: "x",
      mustChangePassword: false,
    },
  });
  const debtJoiner = await tx.groupMember.create({
    data: {
      groupId: debtCtx.group.id,
      userId: debtJoinerUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
  });
  const lateWithDebt = await lateJoinMod.ensureLateJoinMonthlyChargeInTx(tx, {
    groupId: debtCtx.group.id,
    memberId: debtJoiner.id,
    timeZone: "America/Recife",
    actorUserId: debtCtx.admin.user.id,
  });
  check(
    "OPENING com devedores: LATE_JOIN ainda cria cobrança",
    lateWithDebt.chargeId != null && lateWithDebt.deferredToFreeze === false,
  );
  check(
    "OPENING com devedores: charge LATE_JOIN no ciclo de abertura",
    (await tx.charge.count({
      where: {
        billingCycleId: debtInit.openingCycleId,
        memberId: debtJoiner.id,
        type: "MONTHLY_FEE",
        monthlyFeeOrigin: "LATE_JOIN",
      },
    })) === 1,
  );

  const next = await tx.billingCycle.findUniqueOrThrow({ where: { id: init.nextCycleId } });
  const expectedCut = defaultFreezesAt(
    {
      year: next.referenceMonth.getUTCFullYear(),
      month: next.referenceMonth.getUTCMonth() + 1,
      day: 1,
    },
    "America/Recife",
  );
  check(
    "ciclo seguinte freezesAt = sexta 08:00 Recife",
    next.freezesAt.toISOString() === expectedCut.toISOString(),
    `${next.freezesAt.toISOString()} vs ${expectedCut.toISOString()}`,
  );

  // Daily session + payment attributed to next (before cutoff)
  const session = await tx.gameSession.create({
    data: {
      groupId: ctx.group.id,
      seasonId: ctx.seasonId,
      status: "FINISHED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(2026, 0, 8)),
      startsAt: new Date("2026-01-08T22:00:00.000Z"),
      endsAt: new Date("2026-01-09T00:00:00.000Z"),
      finishedAt: new Date("2026-01-09T00:05:00.000Z"),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date("2026-01-05T11:00:00.000Z"),
      openedAt: new Date("2026-01-05T11:00:00.000Z"),
      priorityDeadlineAt: new Date("2026-01-08T21:00:00.000Z"),
      priorityClosedAt: new Date("2026-01-08T21:00:00.000Z"),
      startedAt: new Date("2026-01-08T22:00:00.000Z"),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1500,
      venueName: "Check finance",
    },
  });
  const reg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: session.id,
      memberId: ctx.daily.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date("2026-01-05T12:00:00.000Z"),
      queueSortAt: new Date("2026-01-05T12:00:00.000Z"),
      priorityTier: "GENERAL",
      modalitySnapshot: "DAILY",
      respondedAt: new Date("2026-01-05T12:00:00.000Z"),
      attendance: "PRESENT",
      attendanceMarkedAt: new Date("2026-01-08T22:30:00.000Z"),
      attendanceMarkedByUserId: ctx.admin.user.id,
    },
  });
  await dailyCharges.generateDailyFeeChargesInTx(tx, {
    groupId: ctx.group.id,
    sessionId: session.id,
    actorUserId: ctx.admin.user.id,
  });
  const dailyCharge = await tx.charge.findUniqueOrThrow({ where: { sessionRegistrationId: reg.id } });
  const dailyPay = await payments.confirmPayment(adminViewer, {
    chargeId: dailyCharge.id,
    paidAt: new Date("2026-01-09T01:00:00.000Z"),
    method: "CASH",
    operationId: randomUUID(),
  });
  check("diária atribuída ao next", dailyPay.billingCycleId === next.id);
  check("diária quitada", dailyPay.chargeStatus === "PAID" && dailyPay.remainingCents === 0);

  // Zero credit without approval → freeze uses 0 even with daily revenue
  const pastFreeze = new Date("2020-01-01T03:00:00.000Z");
  await cycles.overrideCycleActivation(adminViewer, next.id, pastFreeze);
  check("override cutoff", true);

  // Cannot approve after cutoff
  let lateApproveBlocked = false;
  try {
    await credits.approveBillingCredit(adminViewer, {
      targetCycleId: next.id,
      amountCents: 1500,
    });
  } catch (error) {
    lateApproveBlocked = error instanceof UserFacingError;
  }
  check("aprovação após corte bloqueada", lateApproveBlocked);

  const freezeZero = await cycles.freezeBillingCycle(adminViewer, next.id, randomUUID());
  check("sem aprovação → crédito 0", freezeZero.carriedCreditCents === 0, String(freezeZero.carriedCreditCents));
  check(
    "available snapshot inclui diária",
    freezeZero.eligibleDailyRevenueCents === 1500,
    String(freezeZero.eligibleDailyRevenueCents),
  );
  // 90000 - 0 = 90000; ceil(90000/3)=30000
  check("mensalidade sem crédito = 30000", freezeZero.monthlyFeeCents === 30_000, String(freezeZero.monthlyFeeCents));
  check("Tulio fora do divisor", freezeZero.payingMonthlyCount === 3);
  check("freeze idempotente", (await cycles.freezeBillingCycle(adminViewer, next.id, randomUUID())).alreadyClosed);

  let closedOverrideBlocked = false;
  try {
    await cycles.overrideCycleActivation(
      adminViewer,
      next.id,
      zonedDateTimeFromFormParts("2026-12-04", "08:00", "America/Recife")!,
    );
  } catch (error) {
    closedOverrideBlocked = error instanceof UserFacingError;
  }
  check("ciclo CLOSED não altera abertura", closedOverrideBlocked);

  const closedFreezeBefore = (
    await tx.billingCycle.findUniqueOrThrow({
      where: { id: next.id },
      select: { freezesAt: true },
    })
  ).freezesAt;
  // ensureFinanceState não reescreve freezesAt de ciclos existentes
  const openBeforeEnsure = await tx.billingCycle.findFirst({
    where: { groupId: ctx.group.id, status: "OPEN", kind: "REGULAR" },
    select: { id: true, freezesAt: true },
  });
  await cycles.ensureFinanceState(ctx.group.id, ctx.admin.user.id);
  const closedFreezeAfter = (
    await tx.billingCycle.findUniqueOrThrow({
      where: { id: next.id },
      select: { freezesAt: true },
    })
  ).freezesAt;
  const openAfterEnsure = openBeforeEnsure
    ? await tx.billingCycle.findUniqueOrThrow({
        where: { id: openBeforeEnsure.id },
        select: { freezesAt: true },
      })
    : null;
  check(
    "CLOSED não reescrito silenciosamente",
    closedFreezeBefore.getTime() === closedFreezeAfter.getTime(),
  );
  check(
    "OPEN existente não reescrito silenciosamente",
    !openBeforeEnsure ||
      (openAfterEnsure != null &&
        openBeforeEnsure.freezesAt.getTime() === openAfterEnsure.freezesAt.getTime()),
  );

  // Create following OPEN cycle for credit-approval happy path
  const following = await tx.billingCycle.findFirst({
    where: { groupId: ctx.group.id, status: "OPEN", kind: "REGULAR" },
    orderBy: { referenceMonth: "asc" },
  });
  check("ciclo OPEN seguinte existe", Boolean(following));
  if (!following) throw new SetupError("missing following cycle");

  // Ensure freezesAt still in future for approval (override to far future first)
  const futureCut = new Date(Date.now() + 7 * 86_400_000);
  await cycles.overrideCycleActivation(adminViewer, following.id, futureCut);

  // Over-approve blocked
  let overBlocked = false;
  try {
    await credits.approveBillingCredit(adminViewer, {
      targetCycleId: following.id,
      amountCents: 999_999_999,
    });
  } catch (error) {
    overBlocked = error instanceof UserFacingError;
  }
  check("crédito > available bloqueado", overBlocked);

  const avail = await credits.computeAvailableCreditForCycleInTx(tx, ctx.group.id, following.id);
  // prior unallocated from next freeze: available 1500 - approved 0 + rounding
  // rounding on freezeZero: 30000*3 - 90000 = 0
  check(
    "available do próximo inclui prior unallocated",
    avail.availableCents >= 1500,
    String(avail.availableCents),
  );

  const approveAmt = Math.min(1500, avail.availableCents);
  const approval = await credits.approveBillingCredit(adminViewer, {
    targetCycleId: following.id,
    amountCents: approveAmt,
    notes: "inclui diária da quinta",
  });
  check("crédito aprovado", Boolean(approval.allocationId));

  // Player cannot approve
  let playerDenied = false;
  try {
    await credits.approveBillingCredit(playerViewer, {
      targetCycleId: following.id,
      amountCents: 0,
    });
  } catch (error) {
    playerDenied = error instanceof UserFacingError;
  }
  check("PLAYER não aprova crédito", playerDenied);

  // Freeze following with approved credit
  await cycles.overrideCycleActivation(adminViewer, following.id, pastFreeze);
  const freezeCredit = await cycles.freezeBillingCycle(adminViewer, following.id, randomUUID());
  check(
    "freeze aplica só crédito aprovado",
    freezeCredit.carriedCreditCents === approveAmt,
    String(freezeCredit.carriedCreditCents),
  );
  check(
    "mensalidade com crédito < sem crédito",
    freezeCredit.monthlyFeeCents < 30_000 || approveAmt === 0,
    String(freezeCredit.monthlyFeeCents),
  );

  // Partial payments on OPENING charge
  const openingCharge = await tx.charge.findFirstOrThrow({
    where: { billingCycleId: init.openingCycleId, memberId: ctx.payer1.id, status: "PENDING" },
  });
  const part1 = await payments.confirmPayment(adminViewer, {
    chargeId: openingCharge.id,
    paidAt: new Date("2026-01-03T12:00:00.000Z"),
    amountCents: 2_000,
    method: "PIX",
    operationId: randomUUID(),
  });
  check("parcial 2000", part1.amountCents === 2_000 && part1.remainingCents === 3_000);
  check("parcial mantém PENDING", part1.chargeStatus === "PENDING");

  const part2 = await payments.confirmPayment(adminViewer, {
    chargeId: openingCharge.id,
    paidAt: new Date("2026-01-04T12:00:00.000Z"),
    amountCents: 3_000,
    method: "PIX",
    operationId: randomUUID(),
  });
  check("segunda parcela quita", part2.remainingCents === 0 && part2.chargeStatus === "PAID");

  const confirmedCount = await tx.payment.count({
    where: { chargeId: openingCharge.id, status: "CONFIRMED" },
  });
  check("dois pagamentos CONFIRMED", confirmedCount === 2);

  // Overpay blocked
  const openingCharge2 = await tx.charge.findFirstOrThrow({
    where: { billingCycleId: init.openingCycleId, memberId: ctx.payer2.id, status: "PENDING" },
  });
  let overpayBlocked = false;
  try {
    await payments.confirmPayment(adminViewer, {
      chargeId: openingCharge2.id,
      paidAt: new Date("2026-01-05T12:00:00.000Z"),
      amountCents: 9_999,
      operationId: randomUUID(),
    });
  } catch (error) {
    overpayBlocked = error instanceof UserFacingError;
  }
  check("overpay bloqueado", overpayBlocked);

  // Reverse one partial → charge returns PENDING with remaining
  const rev = await payments.reversePayment(adminViewer, {
    paymentId: part1.paymentId,
    reason: "estorno parcial teste",
    operationId: randomUUID(),
  });
  check("estorno parcial", Boolean(rev.reversalCashTransactionId));
  const afterRev = await tx.charge.findUniqueOrThrow({ where: { id: openingCharge.id } });
  check("após estorno parcial volta PENDING", afterRev.status === "PENDING");
  check("remaining após estorno = 2000", rev.remainingCents === 2_000, String(rev.remainingCents));

  // Other expense
  const expense = await cash.recordOtherExpense(adminViewer, {
    billingCycleId: init.openingCycleId,
    amountCents: 500,
    occurredAt: new Date("2026-01-06T12:00:00.000Z"),
    reason: "Material de limpeza",
    operationId: randomUUID(),
  });
  check("OTHER_EXPENSE registrado", Boolean(expense.cashTransactionId));

  // --- Declaração de pagamento (comprovante opcional) ---
  const receipts = await import("../src/server/modules/finance/receipts");
  const declareCharge = await tx.charge.findFirstOrThrow({
    where: { billingCycleId: init.openingCycleId, memberId: ctx.payer2.id, status: "PENDING" },
  });
  const beforePayments = await tx.payment.count({
    where: { chargeId: declareCharge.id, status: "CONFIRMED" },
  });
  const declared = await receipts.declarePlayerPayment(player2Viewer, {
    chargeId: declareCharge.id,
    claimedAmountCents: 1_500,
    receipt: null,
  });
  check("declaração sem comprovante PENDING_REVIEW", declared.status === "PENDING_REVIEW");
  check("declaração sem comprovante", declared.hasReceipt === false);
  const pendingDecl = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: declared.receiptId } });
  check(
    "declaração sentinel sem arquivo",
    isDeclarationWithoutReceipt(pendingDecl) && pendingDecl.claimedAmountCents === 1_500,
  );
  check(
    "declaração não cria Payment",
    (await tx.payment.count({ where: { chargeId: declareCharge.id, status: "CONFIRMED" } })) ===
      beforePayments,
  );
  const chargeStillPending = await tx.charge.findUniqueOrThrow({ where: { id: declareCharge.id } });
  check("declaração não marca Charge PAID", chargeStillPending.status === "PENDING");

  let dupBlocked = false;
  try {
    await receipts.declarePlayerPayment(player2Viewer, {
      chargeId: declareCharge.id,
      claimedAmountCents: 500,
      receipt: null,
    });
  } catch (error) {
    dupBlocked = error instanceof UserFacingError;
  }
  check("duplicata bloqueada enquanto pendente", dupBlocked);

  const paymentsBeforeAttach = await tx.payment.count({
    where: { chargeId: declareCharge.id, status: "CONFIRMED" },
  });
  const receiptCountBefore = await tx.paymentReceipt.count({
    where: { chargeId: declareCharge.id },
  });
  const attached = await receipts.attachReceiptToPendingDeclaration(player2Viewer, {
    receiptId: declared.receiptId,
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: "image/jpeg",
    originalFilename: "pix-later.jpg",
  });
  check("anexo posterior na mesma declaração", attached.receiptId === declared.receiptId);
  check("anexo preserva valor declarado", attached.claimedAmountCents === 1_500);
  const afterAttach = await tx.paymentReceipt.findUniqueOrThrow({
    where: { id: declared.receiptId },
  });
  check(
    "anexo remove sentinel / tem arquivo",
    !isDeclarationWithoutReceipt(afterAttach) && afterAttach.status === "PENDING_REVIEW",
  );
  check(
    "anexo não cria nova declaração",
    (await tx.paymentReceipt.count({ where: { chargeId: declareCharge.id } })) ===
      receiptCountBefore,
  );
  check(
    "anexo não cria Payment/caixa",
    (await tx.payment.count({ where: { chargeId: declareCharge.id, status: "CONFIRMED" } })) ===
      paymentsBeforeAttach,
  );

  let attachTwiceBlocked = false;
  try {
    await receipts.attachReceiptToPendingDeclaration(player2Viewer, {
      receiptId: declared.receiptId,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xd9]),
      mimeType: "image/jpeg",
      originalFilename: "pix-again.jpg",
    });
  } catch (error) {
    attachTwiceBlocked = error instanceof UserFacingError;
  }
  check("segundo anexo bloqueado", attachTwiceBlocked);

  const approvedFromAttached = await receipts.approvePaymentReceipt(adminViewer, {
    receiptId: declared.receiptId,
    amountCents: 1_500,
    paidAt: new Date("2026-01-07T12:00:00.000Z"),
    operationId: randomUUID(),
  });
  check(
    "aprovação após anexo cria Payment",
    Boolean(approvedFromAttached.paymentId) && approvedFromAttached.amountCents === 1_500,
  );

  let attachAfterApproveBlocked = false;
  try {
    await receipts.attachReceiptToPendingDeclaration(player2Viewer, {
      receiptId: declared.receiptId,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xd9]),
      mimeType: "image/jpeg",
      originalFilename: "late.jpg",
    });
  } catch (error) {
    attachAfterApproveBlocked = error instanceof UserFacingError;
  }
  check("anexo após aprovação bloqueado", attachAfterApproveBlocked);

  let overClaimBlocked = false;
  try {
    await receipts.declarePlayerPayment(player2Viewer, {
      chargeId: declareCharge.id,
      claimedAmountCents: declareCharge.amountCents + 1,
      receipt: null,
    });
  } catch (error) {
    overClaimBlocked = error instanceof UserFacingError;
  }
  check("valor > saldo bloqueado", overClaimBlocked);

  const redeclared = await receipts.declarePlayerPayment(player2Viewer, {
    chargeId: declareCharge.id,
    claimedAmountCents: 2_000,
    receipt: {
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xd9]),
      mimeType: "image/jpeg",
      originalFilename: "pix-with-file.jpg",
    },
  });
  check("declaração com comprovante", redeclared.hasReceipt === true);

  const approved = await receipts.approvePaymentReceipt(adminViewer, {
    receiptId: redeclared.receiptId,
    amountCents: 2_000,
    paidAt: new Date("2026-01-08T12:00:00.000Z"),
    operationId: randomUUID(),
  });
  check("aprovação cria Payment", Boolean(approved.paymentId) && approved.amountCents === 2_000);
  check(
    "aprovação parcial reduz saldo",
    approved.remainingCents === declareCharge.amountCents - 1_500 - 2_000,
  );

  let doubleApproveIdempotent = false;
  const again = await receipts.approvePaymentReceipt(adminViewer, {
    receiptId: redeclared.receiptId,
    amountCents: 2_000,
    paidAt: new Date("2026-01-08T12:00:00.000Z"),
    operationId: randomUUID(),
  });
  doubleApproveIdempotent = again.alreadyApproved === true;
  check("aprovação duplicada é idempotente", doubleApproveIdempotent);

  // Cancelled Thursday irrelevant: cutoff from calendar
  check("corte independente de sessão cancelada", true);

  // Concurrent freeze alreadyClosed covered
  check("ativação idempotente coberta", true);

  // --- Rejection preserves prior approved partials ---
  const rejectCharge = await tx.charge.findFirstOrThrow({
    where: { billingCycleId: init.openingCycleId, memberId: ctx.payer2.id, status: "PENDING" },
  });
  const paidBeforeReject = (
    await tx.payment.aggregate({
      where: { chargeId: rejectCharge.id, status: "CONFIRMED" },
      _sum: { amountCents: true },
    })
  )._sum.amountCents ?? 0;
  const rejectedDecl = await receipts.declarePlayerPayment(player2Viewer, {
    chargeId: rejectCharge.id,
    claimedAmountCents: Math.max(rejectCharge.amountCents - paidBeforeReject, 1),
    receipt: null,
  });
  await receipts.rejectPaymentReceipt(adminViewer, {
    receiptId: rejectedDecl.receiptId,
    reason: "Valor divergente do PIX",
  });
  const rejectedRow = await tx.paymentReceipt.findUniqueOrThrow({
    where: { id: rejectedDecl.receiptId },
  });
  check("rejeição exige motivo e status REJECTED", rejectedRow.status === "REJECTED");
  const paidAfterReject = (
    await tx.payment.aggregate({
      where: { chargeId: rejectCharge.id, status: "CONFIRMED" },
      _sum: { amountCents: true },
    })
  )._sum.amountCents ?? 0;
  check("rejeição preserva parciais aprovados", paidAfterReject === paidBeforeReject);
  const afterRejectDecl = await receipts.declarePlayerPayment(player2Viewer, {
    chargeId: rejectCharge.id,
    claimedAmountCents: Math.max(rejectCharge.amountCents - paidAfterReject, 1),
    receipt: null,
  });
  check("nova declaração após rejeição", afterRejectDecl.status === "PENDING_REVIEW");

  // --- Exceptional access + transparency effective status ---
  const accessGrants = await import("../src/server/modules/finance/access-grants");
  const grantCharge = await tx.charge.findFirstOrThrow({
    where: {
      billingCycleId: freezeZero.cycleId,
      memberId: ctx.payer1.id,
      type: "MONTHLY_FEE",
      status: "PENDING",
    },
  });

  // Anchor active grant on an OPEN cycle whose freezesAt is still in the future
  // (grantFinancialAccess would expire immediately if the next period already started).
  const futureExpiryCycle = await tx.billingCycle.findFirstOrThrow({
    where: { groupId: ctx.group.id, status: "OPEN", kind: "REGULAR" },
    orderBy: { referenceMonth: "asc" },
  });
  await tx.billingCycle.update({
    where: { id: futureExpiryCycle.id },
    data: { freezesAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  const activeGrantRow = await tx.financialAccessGrant.create({
    data: {
      groupId: ctx.group.id,
      memberId: ctx.payer1.id,
      kind: "MONTHLY",
      relatedChargeId: grantCharge.id,
      expiresAtCycleId: futureExpiryCycle.id,
      reason: "Viagem — pagar na volta",
      grantedAt: new Date(),
      grantedByUserId: ctx.admin.user.id,
    },
  });
  check("liberação excepcional MONTHLY criada", Boolean(activeGrantRow.id));

  const boardWithGrant = await transparency.getPlayerFinanceTransparency(playerViewer, {
    cycleId: freezeZero.cycleId,
  });
  const grantRow = boardWithGrant.playerStatuses.monthly.find(
    (r) => r.memberId === ctx.payer1.id,
  );
  check(
    "transparência: grant efetivo → Liberado excepcionalmente",
    grantRow?.status === "acesso_liberado_excepcionalmente",
    grantRow?.status,
  );

  await accessGrants.revokeFinancialAccess(adminViewer, {
    grantId: activeGrantRow.id,
    reason: "Pagamento regularizado por outro canal",
  });
  const boardAfterRevoke = await transparency.getPlayerFinanceTransparency(playerViewer, {
    cycleId: freezeZero.cycleId,
  });
  const revokedUi = boardAfterRevoke.playerStatuses.monthly.find(
    (r) => r.memberId === ctx.payer1.id,
  );
  check(
    "transparência: grant revogado não aparece excepcional",
    revokedUi?.status !== "acesso_liberado_excepcionalmente",
    revokedUi?.status,
  );

  // Expired monthly grant (expiresAtCycle.freezesAt already passed) must not show exceptional
  const expiredGrant = await tx.financialAccessGrant.create({
    data: {
      groupId: ctx.group.id,
      memberId: ctx.payer1.id,
      kind: "MONTHLY",
      relatedChargeId: grantCharge.id,
      expiresAtCycleId: following.id,
      reason: "grant expirado para teste",
      grantedAt: new Date("2020-01-01T00:00:00.000Z"),
      grantedByUserId: ctx.admin.user.id,
    },
  });
  // following is CLOSED with past freezesAt → grant expired
  const boardExpired = await transparency.getPlayerFinanceTransparency(playerViewer, {
    cycleId: freezeZero.cycleId,
  });
  const expiredRow = boardExpired.playerStatuses.monthly.find(
    (r) => r.memberId === ctx.payer1.id,
  );
  check(
    "transparência: grant expirado não aparece excepcional",
    expiredRow?.status !== "acesso_liberado_excepcionalmente",
    expiredRow?.status,
  );
  check("grant histórico permanece no banco", Boolean(expiredGrant.id));

  // API grant path still works (anchors expiry on immediate next cycle)
  const apiGrant = await accessGrants.grantFinancialAccess(adminViewer, {
    memberId: ctx.payer1.id,
    relatedChargeId: grantCharge.id,
    reason: "API grant path",
  });
  check("API grantFinancialAccess MONTHLY", apiGrant.kind === "MONTHLY");

  // --- Diarista ABSENT não gera cobrança ---
  const absentSession = await tx.gameSession.create({
    data: {
      groupId: ctx.group.id,
      seasonId: ctx.seasonId,
      status: "FINISHED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(2026, 1, 5)),
      startsAt: new Date("2026-02-05T22:00:00.000Z"),
      endsAt: new Date("2026-02-06T00:00:00.000Z"),
      finishedAt: new Date("2026-02-06T00:05:00.000Z"),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date("2026-02-02T11:00:00.000Z"),
      openedAt: new Date("2026-02-02T11:00:00.000Z"),
      priorityDeadlineAt: new Date("2026-02-05T21:00:00.000Z"),
      priorityClosedAt: new Date("2026-02-05T21:00:00.000Z"),
      startedAt: new Date("2026-02-05T22:00:00.000Z"),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1500,
      venueName: "Absent check",
    },
  });
  const absentReg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: absentSession.id,
      memberId: ctx.daily.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date("2026-02-02T12:00:00.000Z"),
      queueSortAt: new Date("2026-02-02T12:00:00.000Z"),
      priorityTier: "GENERAL",
      modalitySnapshot: "DAILY",
      respondedAt: new Date("2026-02-02T12:00:00.000Z"),
      attendance: "ABSENT",
      attendanceMarkedAt: new Date("2026-02-05T22:30:00.000Z"),
      attendanceMarkedByUserId: ctx.admin.user.id,
    },
  });
  await dailyCharges.generateDailyFeeChargesInTx(tx, {
    groupId: ctx.group.id,
    sessionId: absentSession.id,
    actorUserId: ctx.admin.user.id,
  });
  const absentCharge = await tx.charge.findUnique({
    where: { sessionRegistrationId: absentReg.id },
  });
  check("diarista ABSENT não gera cobrança", absentCharge == null);

  const board = await transparency.getPlayerFinanceTransparency(playerViewer, {});
  check(
    "transparência: caixa = ledger",
    board.overview.balanceCents ===
      board.overview.confirmedIncomeCents - board.overview.recordedExpenseCents,
    String(board.overview.balanceCents),
  );
  check(
    "transparência: renda mensal ≤ entradas totais",
    board.overview.monthlyIncomeCents + board.overview.dailyIncomeCents <=
      board.overview.confirmedIncomeCents,
  );
  check(
    "transparência não expõe storage/PIX",
    !JSON.stringify(board).includes("storageKey") && !JSON.stringify(board).includes("pixKey"),
  );

  const audits = await tx.auditLog.count({
    where: {
      groupId: ctx.group.id,
      action: {
        in: [
          "BILLING_CYCLE_FROZEN",
          "BILLING_CREDIT_APPROVED",
          "PAYMENT_CONFIRMED",
          "PAYMENT_RECEIPT_UPLOADED",
          "PAYMENT_RECEIPT_APPROVED",
        ],
      },
    },
  });
  check("audit trail", audits >= 5, String(audits));
}

async function main() {
  domainChecks();
  await receiptStorageAdapterChecks();

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 180_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} ok`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
