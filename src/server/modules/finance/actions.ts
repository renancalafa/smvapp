"use server";

import { randomUUID } from "node:crypto";
import {
  zonedDateTimeFromDatetimeLocal,
  zonedDateTimeFromFormParts,
} from "@/domain/finance/cycleDates";
import { requireAdminAction } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { confirmPayment, reversePayment } from "./payments";
import { freezeBillingCycle, overrideCycleActivation } from "./cycles";
import { initializeFinance } from "./initialize";
import { recordFieldCost, reverseCashTransaction, recordOtherExpense, recordCashAdjustment } from "./cash";
import { approveBillingCredit } from "./credits";
import { setMemberFeeExempt, updateFinanceSettings } from "./settings";

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseGroupDatetimeLocal(raw: string, timeZone: string): Date | null {
  if (!raw) return null;
  return zonedDateTimeFromDatetimeLocal(raw, timeZone);
}

function formInt(formData: FormData, key: string): number | null {
  const raw = formText(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function operationIdOf(formData: FormData): string {
  const raw = formText(formData, "operationId");
  return raw || randomUUID();
}

function failure(action: string, error: unknown): { ok: false; error: string } {
  const message = error instanceof UserFacingError ? error.message : "Não foi possível concluir a operação.";
  if (!(error instanceof UserFacingError)) console.error(action, error);
  return { ok: false, error: message };
}

export async function updateFinanceSettingsAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    await updateFinanceSettings(viewer, {
      dailyFeeCents: formInt(formData, "dailyFeeCents") ?? undefined,
      monthlyFieldCostCents: formInt(formData, "monthlyFieldCostCents") ?? undefined,
      pixKey: formData.has("pixKey") ? formText(formData, "pixKey") || null : undefined,
      pixKeyType: formData.has("pixKeyType") ? formText(formData, "pixKeyType") || null : undefined,
      pixBeneficiaryName: formData.has("pixBeneficiaryName")
        ? formText(formData, "pixBeneficiaryName") || null
        : undefined,
    });
    return { ok: true as const };
  } catch (error) {
    return failure("updateFinanceSettingsAction", error);
  }
}

export async function setMemberFeeExemptAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const memberId = formText(formData, "memberId");
    const feeExempt = formText(formData, "feeExempt") === "true";
    const reason = formText(formData, "reason") || null;
    await setMemberFeeExempt(viewer, memberId, feeExempt, reason);
    return { ok: true as const };
  } catch (error) {
    return failure("setMemberFeeExemptAction", error);
  }
}

export async function freezeBillingCycleAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const cycleId = formText(formData, "cycleId");
    const result = await freezeBillingCycle(viewer, cycleId, operationIdOf(formData));
    return { ok: true as const, result };
  } catch (error) {
    return failure("freezeBillingCycleAction", error);
  }
}

export async function overrideCycleActivationAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const cycleId = formText(formData, "cycleId");
    const openDate = formText(formData, "openDate");
    const openTime = formText(formData, "openTime");
    const freezesAt =
      openDate && openTime
        ? zonedDateTimeFromFormParts(openDate, openTime, viewer.group.timezone)
        : (() => {
            const raw = formText(formData, "freezesAt");
            const parsed = raw ? new Date(raw) : null;
            return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
          })();
    if (!freezesAt) {
      throw new UserFacingError("Data/hora de abertura inválida.");
    }
    await overrideCycleActivation(viewer, cycleId, freezesAt);
    return { ok: true as const };
  } catch (error) {
    return failure("overrideCycleActivationAction", error);
  }
}

export async function confirmPaymentAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const chargeId = formText(formData, "chargeId");
    const paidAtRaw = formText(formData, "paidAt");
    const paidAt = paidAtRaw
      ? parseGroupDatetimeLocal(paidAtRaw, viewer.group.timezone)
      : new Date();
    if (!paidAt || Number.isNaN(paidAt.getTime())) {
      throw new UserFacingError("Data do pagamento inválida.");
    }
    const amountCents = formInt(formData, "amountCents") ?? undefined;
    const methodRaw = formText(formData, "method");
    const method =
      methodRaw === "CASH" || methodRaw === "PIX" || methodRaw === "BANK_TRANSFER" || methodRaw === "OTHER"
        ? methodRaw
        : null;
    const result = await confirmPayment(viewer, {
      chargeId,
      paidAt,
      amountCents,
      method,
      notes: formText(formData, "notes") || null,
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("confirmPaymentAction", error);
  }
}

export async function approveBillingCreditAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const amountCents = formInt(formData, "amountCents");
    if (amountCents == null) throw new UserFacingError("Valor de crédito inválido.");
    const result = await approveBillingCredit(viewer, {
      targetCycleId: formText(formData, "targetCycleId"),
      amountCents,
      notes: formText(formData, "notes") || null,
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("approveBillingCreditAction", error);
  }
}

export async function reversePaymentAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const result = await reversePayment(viewer, {
      paymentId: formText(formData, "paymentId"),
      reason: formText(formData, "reason"),
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("reversePaymentAction", error);
  }
}

export async function recordFieldCostAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const amountCents = formInt(formData, "amountCents");
    if (amountCents == null) throw new UserFacingError("Valor inválido.");
    const occurredRaw = formText(formData, "occurredAt");
    const occurredAt = occurredRaw
      ? parseGroupDatetimeLocal(occurredRaw, viewer.group.timezone)
      : new Date();
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
      throw new UserFacingError("Data inválida.");
    }
    const result = await recordFieldCost(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      amountCents,
      occurredAt,
      notes: formText(formData, "notes") || null,
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("recordFieldCostAction", error);
  }
}

export async function reverseCashTransactionAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const result = await reverseCashTransaction(viewer, {
      cashTransactionId: formText(formData, "cashTransactionId"),
      reason: formText(formData, "reason"),
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("reverseCashTransactionAction", error);
  }
}

export async function initializeFinanceAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const debtorRaw = formText(formData, "debtorMemberIds");
    const debtorMemberIds = debtorRaw
      ? debtorRaw.split(",").map((id) => id.trim()).filter(Boolean)
      : [];
    const initialBalanceCents = formInt(formData, "initialBalanceCents") ?? 0;
    const openingMonthlyFeeCents = formInt(formData, "openingMonthlyFeeCents") ?? 0;
    const remainingFieldCostCents = formInt(formData, "remainingFieldCostCents") ?? 0;
    const result = await initializeFinance(viewer, {
      initialBalanceCents,
      openingMonthlyFeeCents,
      remainingFieldCostCents,
      debtorMemberIds,
      reason: formText(formData, "reason"),
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("initializeFinanceAction", error);
  }
}

export async function recordOtherExpenseAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const amountCents = formInt(formData, "amountCents");
    if (amountCents == null) throw new UserFacingError("Valor inválido.");
    const occurredRaw = formText(formData, "occurredAt");
    const occurredAt = occurredRaw
      ? parseGroupDatetimeLocal(occurredRaw, viewer.group.timezone)
      : new Date();
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
      throw new UserFacingError("Data inválida.");
    }
    const result = await recordOtherExpense(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      amountCents,
      occurredAt,
      reason: formText(formData, "reason"),
      notes: formText(formData, "notes") || null,
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("recordOtherExpenseAction", error);
  }
}

export async function recordCashAdjustmentAction(formData: FormData) {
  try {
    const viewer = await requireAdminAction();
    const amountCents = formInt(formData, "amountCents");
    if (amountCents == null) throw new UserFacingError("Valor inválido.");
    const directionRaw = formText(formData, "direction");
    if (directionRaw !== "IN" && directionRaw !== "OUT") {
      throw new UserFacingError("Direção do ajuste inválida.");
    }
    const occurredRaw = formText(formData, "occurredAt");
    const occurredAt = occurredRaw
      ? parseGroupDatetimeLocal(occurredRaw, viewer.group.timezone)
      : new Date();
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
      throw new UserFacingError("Data inválida.");
    }
    const result = await recordCashAdjustment(viewer, {
      billingCycleId: formText(formData, "billingCycleId"),
      direction: directionRaw,
      amountCents,
      occurredAt,
      reason: formText(formData, "reason"),
      operationId: operationIdOf(formData),
    });
    return { ok: true as const, result };
  } catch (error) {
    return failure("recordCashAdjustmentAction", error);
  }
}
