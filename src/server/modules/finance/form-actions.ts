"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireAdminAction } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { zonedDateTimeFromFormParts } from "@/domain/finance/cycleDates";
import { parseBRLToCents } from "@/lib/money";
import { confirmPayment, reversePayment } from "./payments";
import { freezeBillingCycle, overrideCycleActivation } from "./cycles";
import { initializeFinance } from "./initialize";
import {
  recordFieldCost,
  reverseCashTransaction,
  recordOtherExpense,
  recordCashAdjustment,
} from "./cash";
import { approveBillingCredit } from "./credits";
import { setMemberFeeExempt, updateFinanceSettings } from "./settings";

export type FinanceFormState =
  | { status: "error"; error: string }
  | { status: "saved"; message?: string }
  | undefined;

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function moneyCents(formData: FormData, key: string): number | null {
  const raw = formText(formData, key);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return parseBRLToCents(raw);
}

function opId(formData: FormData): string {
  return formText(formData, "operationId") || randomUUID();
}

function fail(error: unknown): FinanceFormState {
  if (error instanceof UserFacingError) return { status: "error", error: error.message };
  console.error(error);
  return { status: "error", error: "Não foi possível concluir a operação." };
}

export async function saveFinanceSettingsForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const dailyFeeCents = moneyCents(formData, "dailyFeeCents");
    const monthlyFieldCostCents = moneyCents(formData, "monthlyFieldCostCents");
    await updateFinanceSettings(viewer, {
      dailyFeeCents: dailyFeeCents ?? undefined,
      monthlyFieldCostCents: monthlyFieldCostCents ?? undefined,
      timezone: formData.has("timezone") ? formText(formData, "timezone") : undefined,
      pixKey: formData.has("pixKey") ? formText(formData, "pixKey") || null : undefined,
      pixKeyType: formData.has("pixKeyType") ? formText(formData, "pixKeyType") || null : undefined,
      pixBeneficiaryName: formData.has("pixBeneficiaryName")
        ? formText(formData, "pixBeneficiaryName") || null
        : undefined,
    });
    refresh();
    return { status: "saved", message: "Configurações financeiras salvas." };
  } catch (error) {
    return fail(error);
  }
}

export async function setFeeExemptForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    await setMemberFeeExempt(
      viewer,
      formText(formData, "memberId"),
      formText(formData, "feeExempt") === "true",
      formText(formData, "reason") || null,
    );
    refresh();
    return { status: "saved", message: "Isenção atualizada." };
  } catch (error) {
    return fail(error);
  }
}

export async function approveCreditForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const amountCents = moneyCents(formData, "amountCents");
    if (amountCents == null || amountCents < 0) {
      return { status: "error", error: "Informe um valor de crédito válido." };
    }
    await approveBillingCredit(viewer, {
      targetCycleId: formText(formData, "targetCycleId"),
      amountCents,
      notes: formText(formData, "notes") || null,
    });
    refresh();
    return { status: "saved", message: "Crédito aprovado." };
  } catch (error) {
    return fail(error);
  }
}

export async function overrideActivationForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    if (formText(formData, "confirmChange") !== "yes") {
      return { status: "error", error: "Confirme a alteração antes de salvar." };
    }
    // Sempre o fuso do grupo no servidor — não usa o fuso do navegador.
    const freezesAt = zonedDateTimeFromFormParts(
      formText(formData, "openDate"),
      formText(formData, "openTime"),
      viewer.group.timezone,
    );
    if (!freezesAt) {
      return { status: "error", error: "Data ou horário de abertura inválidos." };
    }
    await overrideCycleActivation(viewer, formText(formData, "cycleId"), freezesAt);
    refresh();
    return { status: "saved", message: "Início da cobrança atualizado para o mês selecionado." };
  } catch (error) {
    return fail(error);
  }
}

export async function freezeCycleForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    await freezeBillingCycle(viewer, formText(formData, "cycleId"), opId(formData));
    refresh();
    return { status: "saved", message: "Ciclo congelado." };
  } catch (error) {
    return fail(error);
  }
}

export async function confirmPaymentForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const amountCents = moneyCents(formData, "amountCents") ?? undefined;
    const methodRaw = formText(formData, "method");
    const method =
      methodRaw === "CASH" || methodRaw === "PIX" || methodRaw === "BANK_TRANSFER" || methodRaw === "OTHER"
        ? methodRaw
        : null;
    const result = await confirmPayment(viewer, {
      chargeId: formText(formData, "chargeId"),
      paidAt: new Date(formText(formData, "paidAt") || Date.now()),
      amountCents,
      method,
      notes: formText(formData, "notes") || null,
      operationId: opId(formData),
    });
    refresh();
    return {
      status: "saved",
      message: result.alreadySettled
        ? "Cobrança já estava quitada."
        : result.remainingCents > 0
          ? `Pagamento parcial registrado. Restam ${(result.remainingCents / 100).toFixed(2)}.`
          : "Pagamento confirmado. Cobrança quitada.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function reversePaymentForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    await reversePayment(viewer, {
      paymentId: formText(formData, "paymentId"),
      reason: formText(formData, "reason"),
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Pagamento estornado." };
  } catch (error) {
    return fail(error);
  }
}

export async function recordFieldCostForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const amountCents = moneyCents(formData, "amountCents");
    if (amountCents == null) return { status: "error", error: "Valor inválido." };
    await recordFieldCost(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      amountCents,
      occurredAt: new Date(formText(formData, "occurredAt") || Date.now()),
      notes: formText(formData, "notes") || null,
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Pagamento do campo registrado." };
  } catch (error) {
    return fail(error);
  }
}

export async function recordOtherExpenseForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const amountCents = moneyCents(formData, "amountCents");
    if (amountCents == null) return { status: "error", error: "Valor inválido." };
    await recordOtherExpense(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      amountCents,
      occurredAt: new Date(formText(formData, "occurredAt") || Date.now()),
      reason: formText(formData, "reason"),
      notes: formText(formData, "notes") || null,
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Despesa registrada." };
  } catch (error) {
    return fail(error);
  }
}

export async function recordAdjustmentForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const amountCents = moneyCents(formData, "amountCents");
    if (amountCents == null) return { status: "error", error: "Valor inválido." };
    const direction = formText(formData, "direction");
    if (direction !== "IN" && direction !== "OUT") {
      return { status: "error", error: "Direção inválida." };
    }
    await recordCashAdjustment(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      direction,
      amountCents,
      occurredAt: new Date(formText(formData, "occurredAt") || Date.now()),
      reason: formText(formData, "reason"),
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Ajuste registrado." };
  } catch (error) {
    return fail(error);
  }
}

export async function reverseCashForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    await reverseCashTransaction(viewer, {
      cashTransactionId: formText(formData, "cashTransactionId"),
      reason: formText(formData, "reason"),
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Lançamento estornado." };
  } catch (error) {
    return fail(error);
  }
}

export async function initializeFinanceForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const debtorRaw = formText(formData, "debtorMemberIds");
    await initializeFinance(viewer, {
      initialBalanceCents: moneyCents(formData, "initialBalanceCents") ?? 0,
      openingMonthlyFeeCents: moneyCents(formData, "openingMonthlyFeeCents") ?? 0,
      remainingFieldCostCents: moneyCents(formData, "remainingFieldCostCents") ?? 0,
      debtorMemberIds: debtorRaw ? debtorRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
      reason: formText(formData, "reason"),
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Implantação financeira concluída." };
  } catch (error) {
    return fail(error);
  }
}

export async function approveReceiptForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const { approvePaymentReceipt } = await import("./receipts");
    const amount = moneyCents(formData, "amountCents") ?? undefined;
    const paidAtRaw = formText(formData, "paidAt");
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return { status: "error", error: "Data do pagamento inválida." };
    }
    const result = await approvePaymentReceipt(viewer, {
      receiptId: formText(formData, "receiptId"),
      amountCents: amount,
      paidAt,
      notes: formText(formData, "notes") || null,
      operationId: opId(formData),
    });
    refresh();
    return {
      status: "saved",
      message: result.alreadyApproved
        ? "Comprovante já estava aprovado."
        : "Pagamento confirmado a partir do comprovante.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function rejectReceiptForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const { rejectPaymentReceipt } = await import("./receipts");
    await rejectPaymentReceipt(viewer, {
      receiptId: formText(formData, "receiptId"),
      reason: formText(formData, "reason"),
      operationId: opId(formData),
    });
    refresh();
    return { status: "saved", message: "Comprovante rejeitado." };
  } catch (error) {
    return fail(error);
  }
}

export async function grantAccessForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const { grantFinancialAccess } = await import("./access-grants");
    await grantFinancialAccess(viewer, {
      memberId: formText(formData, "memberId"),
      relatedChargeId: formText(formData, "relatedChargeId"),
      reason: formText(formData, "reason"),
    });
    refresh();
    return { status: "saved", message: "Acesso liberado excepcionalmente." };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeAccessForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const { revokeFinancialAccess } = await import("./access-grants");
    await revokeFinancialAccess(viewer, {
      grantId: formText(formData, "grantId"),
      reason: formText(formData, "reason"),
    });
    refresh();
    return { status: "saved", message: "Liberação revogada." };
  } catch (error) {
    return fail(error);
  }
}

export async function setFinanceLocksForm(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  try {
    const viewer = await requireAdminAction();
    const enabled = formText(formData, "enabled") === "true";
    const { writeAuditLog } = await import("@/server/audit");
    const { withFinanceTransaction } = await import("./lock");
    await withFinanceTransaction(async (tx) => {
      const before = await tx.groupSettings.findUniqueOrThrow({
        where: { groupId: viewer.group.id },
        select: { financeAccessLocksEnabled: true },
      });
      await tx.groupSettings.update({
        where: { groupId: viewer.group.id },
        data: { financeAccessLocksEnabled: enabled },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "GROUP_SETTINGS_UPDATED",
        entityType: "GroupSettings",
        entityId: viewer.group.id,
        before,
        after: { financeAccessLocksEnabled: enabled },
        metadata: { section: "finance_locks" },
      });
    });
    refresh();
    return {
      status: "saved",
      message: enabled ? "Restrições financeiras ativadas." : "Restrições financeiras desativadas.",
    };
  } catch (error) {
    return fail(error);
  }
}
