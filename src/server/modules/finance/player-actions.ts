"use server";

import { refresh } from "next/cache";
import { requireViewerForPayments } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { parseBRLToCents } from "@/lib/money";
import { attachReceiptToPendingDeclaration, declarePlayerPayment } from "./receipts";

export type PlayerPaymentFormState =
  | { status: "error"; error: string }
  | { status: "saved"; message?: string }
  | undefined;

/** Jogador informa pagamento (comprovante opcional). Não quita nem libera acesso. */
export async function declarePaymentForm(
  _prev: PlayerPaymentFormState,
  formData: FormData,
): Promise<PlayerPaymentFormState> {
  try {
    const viewer = await requireViewerForPayments();
    const chargeId = String(formData.get("chargeId") ?? "").trim();
    const claimedRaw = String(formData.get("claimedAmountCents") ?? "").trim();
    if (!claimedRaw) {
      return { status: "error", error: "Informe o valor pago." };
    }
    const claimedAmountCents = /^\d+$/.test(claimedRaw)
      ? Number(claimedRaw)
      : parseBRLToCents(claimedRaw);
    if (claimedAmountCents == null || claimedAmountCents <= 0) {
      return { status: "error", error: "Valor informado inválido." };
    }

    const file = formData.get("receipt");
    const hasFile = file instanceof File && file.size > 0;
    await declarePlayerPayment(viewer, {
      chargeId,
      claimedAmountCents,
      receipt: hasFile
        ? {
            bytes: Buffer.from(await file.arrayBuffer()),
            mimeType: file.type || "application/octet-stream",
            originalFilename: file.name || "comprovante",
          }
        : null,
    });
    refresh();
    return {
      status: "saved",
      message: "Pagamento informado. Aguardando confirmação do administrador.",
    };
  } catch (error) {
    if (error instanceof UserFacingError) return { status: "error", error: error.message };
    console.error(error);
    return { status: "error", error: "Não foi possível informar o pagamento." };
  }
}

/** Anexa comprovante a declaração PENDING_REVIEW existente (sem criar nova). */
export async function attachReceiptForm(
  _prev: PlayerPaymentFormState,
  formData: FormData,
): Promise<PlayerPaymentFormState> {
  try {
    const viewer = await requireViewerForPayments();
    const receiptId = String(formData.get("receiptId") ?? "").trim();
    if (!receiptId) {
      return { status: "error", error: "Declaração inválida." };
    }
    const file = formData.get("receipt");
    if (!(file instanceof File) || file.size <= 0) {
      return { status: "error", error: "Selecione um comprovante (JPEG, PNG, WebP ou PDF)." };
    }
    await attachReceiptToPendingDeclaration(viewer, {
      receiptId,
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name || "comprovante",
    });
    refresh();
    return {
      status: "saved",
      message: "Comprovante anexado. Continua aguardando confirmação do administrador.",
    };
  } catch (error) {
    if (error instanceof UserFacingError) return { status: "error", error: error.message };
    console.error(error);
    return { status: "error", error: "Não foi possível anexar o comprovante." };
  }
}

/** @deprecated Use declarePaymentForm — mantido só se algum import antigo restar. */
export async function uploadReceiptForm(
  prev: PlayerPaymentFormState,
  formData: FormData,
): Promise<PlayerPaymentFormState> {
  return declarePaymentForm(prev, formData);
}
