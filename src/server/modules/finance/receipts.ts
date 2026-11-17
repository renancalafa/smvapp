import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  DECLARATION_STORAGE_PREFIX,
  DECLARATION_WITHOUT_RECEIPT_FILENAME,
  DECLARATION_WITHOUT_RECEIPT_MIME,
  isDeclarationWithoutReceipt,
} from "@/domain/finance/receiptUpload";
import { formatCentsBRL } from "@/lib/money";
import type { Viewer } from "@/server/auth/dal";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  hashRequest,
} from "@/server/modules/matches/idempotency";
import { confirmPayment } from "./payments";
import { storeReceiptObject, validateReceiptUpload } from "./receipt-storage";
import { withFinanceTransaction } from "./lock";

function requireReason(raw: string | null | undefined, label: string): string {
  const reason = (raw ?? "").trim();
  if (!reason) throw new UserFacingError(`${label} é obrigatório.`);
  return reason;
}

function declarationWithoutReceiptMeta() {
  const token = randomUUID();
  const storageKey = `${DECLARATION_STORAGE_PREFIX}${token}`;
  return {
    storageKey,
    mimeType: DECLARATION_WITHOUT_RECEIPT_MIME,
    byteSize: 1,
    originalFilename: DECLARATION_WITHOUT_RECEIPT_FILENAME,
    contentSha256: createHash("sha256").update(storageKey).digest("hex"),
  };
}

/**
 * Jogador declara pagamento (comprovante opcional).
 * Cria PaymentReceipt PENDING_REVIEW — não quita Charge, não cria Payment/caixa, não libera acesso.
 */
export async function declarePlayerPayment(
  viewer: Viewer,
  input: {
    chargeId: string;
    claimedAmountCents: number;
    receipt?: {
      bytes: Buffer;
      mimeType: string;
      originalFilename: string;
    } | null;
  },
) {
  if (!Number.isInteger(input.claimedAmountCents) || input.claimedAmountCents <= 0) {
    throw new UserFacingError("Informe um valor positivo.");
  }

  const hasFile = Boolean(input.receipt && input.receipt.bytes.byteLength > 0);
  if (hasFile && input.receipt) {
    validateReceiptUpload({
      mimeType: input.receipt.mimeType,
      byteSize: input.receipt.bytes.byteLength,
      originalFilename: input.receipt.originalFilename,
    });
  }

  // Pré-valida cobrança e saldo antes de gravar arquivo.
  const chargePreview = await withFinanceTransaction(async (tx) => {
    const row = await tx.charge.findFirst({
      where: {
        id: input.chargeId,
        groupId: viewer.group.id,
        memberId: viewer.member.id,
      },
      include: {
        payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
        receipts: { where: { status: "PENDING_REVIEW" }, select: { id: true }, take: 1 },
      },
    });
    if (!row) throw new UserFacingError("Cobrança não encontrada.");
    if (row.status === "CANCELLED") throw new UserFacingError("Cobrança cancelada.");
    if (row.status === "PAID") throw new UserFacingError("Cobrança já está paga.");
    if (row.receipts.length > 0) {
      throw new UserFacingError(
        "Já existe um pagamento aguardando aprovação para esta cobrança.",
      );
    }
    const paid = row.payments.reduce((sum, p) => sum + p.amountCents, 0);
    const remainingCents = Math.max(row.amountCents - paid, 0);
    if (remainingCents <= 0) throw new UserFacingError("Cobrança já está quitada.");
    if (input.claimedAmountCents > remainingCents) {
      throw new UserFacingError(
        `Valor maior que o saldo em aberto (${formatCentsBRL(remainingCents)}).`,
      );
    }
    return row;
  });

  const stored = hasFile && input.receipt
    ? await storeReceiptObject({
        groupId: viewer.group.id,
        chargeId: chargePreview.id,
        mimeType: input.receipt.mimeType,
        originalFilename: input.receipt.originalFilename,
        bytes: input.receipt.bytes,
      })
    : declarationWithoutReceiptMeta();

  const originalFilename = hasFile && input.receipt
    ? input.receipt.originalFilename.slice(0, 180)
    : DECLARATION_WITHOUT_RECEIPT_FILENAME;

  return withFinanceTransaction(async (tx) => {
    const row = await tx.charge.findFirst({
      where: {
        id: input.chargeId,
        groupId: viewer.group.id,
        memberId: viewer.member.id,
      },
      include: {
        payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
        receipts: { where: { status: "PENDING_REVIEW" }, select: { id: true }, take: 1 },
      },
    });
    if (!row) throw new UserFacingError("Cobrança não encontrada.");
    if (row.status === "CANCELLED") throw new UserFacingError("Cobrança cancelada.");
    if (row.status === "PAID") throw new UserFacingError("Cobrança já está paga.");
    if (row.receipts.length > 0) {
      throw new UserFacingError(
        "Já existe um pagamento aguardando aprovação para esta cobrança.",
      );
    }
    const paid = row.payments.reduce((sum, p) => sum + p.amountCents, 0);
    const remainingCents = Math.max(row.amountCents - paid, 0);
    if (input.claimedAmountCents > remainingCents) {
      throw new UserFacingError("Valor maior que o saldo em aberto.");
    }

    if (hasFile) {
      const existing = await tx.paymentReceipt.findUnique({
        where: {
          chargeId_contentSha256: {
            chargeId: row.id,
            contentSha256: stored.contentSha256,
          },
        },
      });
      if (existing) {
        throw new UserFacingError("Este comprovante já foi enviado para esta cobrança.");
      }
    }

    const receipt = await tx.paymentReceipt.create({
      data: {
        groupId: viewer.group.id,
        chargeId: row.id,
        memberId: viewer.member.id,
        uploadedByUserId: viewer.user.id,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        originalFilename,
        contentSha256: stored.contentSha256,
        claimedAmountCents: input.claimedAmountCents,
        status: "PENDING_REVIEW",
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PAYMENT_RECEIPT_UPLOADED",
      entityType: "PaymentReceipt",
      entityId: receipt.id,
      after: {
        chargeId: row.id,
        claimedAmountCents: input.claimedAmountCents,
        hasReceipt: hasFile,
        mimeType: hasFile ? stored.mimeType : DECLARATION_WITHOUT_RECEIPT_MIME,
        byteSize: hasFile ? stored.byteSize : 0,
      },
    });

    return {
      receiptId: receipt.id,
      status: receipt.status,
      hasReceipt: hasFile,
      claimedAmountCents: input.claimedAmountCents,
    };
  });
}

/**
 * Anexa arquivo a uma declaração PENDING_REVIEW sem comprovante.
 * Não altera claimedAmountCents, não cria Charge/Payment/caixa, não libera acesso.
 */
export async function attachReceiptToPendingDeclaration(
  viewer: Viewer,
  input: {
    receiptId: string;
    bytes: Buffer;
    mimeType: string;
    originalFilename: string;
  },
) {
  validateReceiptUpload({
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    originalFilename: input.originalFilename,
  });

  const pending = await withFinanceTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentReceipt" WHERE "id" = ${input.receiptId}::uuid FOR UPDATE`;
    const row = await tx.paymentReceipt.findFirst({
      where: { id: input.receiptId, groupId: viewer.group.id },
    });
    if (!row) throw new UserFacingError("Declaração não encontrada.");
    if (row.memberId !== viewer.member.id) {
      throw new UserFacingError("Só o dono da declaração pode anexar comprovante.");
    }
    if (row.status === "APPROVED" || row.status === "REJECTED" || row.status === "SUPERSEDED") {
      throw new UserFacingError("Não é possível anexar comprovante a esta declaração.");
    }
    if (row.status !== "PENDING_REVIEW") {
      throw new UserFacingError("Só declarações aguardando aprovação aceitam comprovante.");
    }
    if (!isDeclarationWithoutReceipt(row)) {
      throw new UserFacingError("Esta declaração já possui comprovante.");
    }
    return row;
  });

  const stored = await storeReceiptObject({
    groupId: viewer.group.id,
    chargeId: pending.chargeId,
    mimeType: input.mimeType,
    originalFilename: input.originalFilename,
    bytes: input.bytes,
  });

  return withFinanceTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentReceipt" WHERE "id" = ${input.receiptId}::uuid FOR UPDATE`;
    const row = await tx.paymentReceipt.findFirst({
      where: { id: input.receiptId, groupId: viewer.group.id },
    });
    if (!row) throw new UserFacingError("Declaração não encontrada.");
    if (row.memberId !== viewer.member.id) {
      throw new UserFacingError("Só o dono da declaração pode anexar comprovante.");
    }
    if (row.status !== "PENDING_REVIEW") {
      throw new UserFacingError("Não é possível anexar comprovante a esta declaração.");
    }
    if (!isDeclarationWithoutReceipt(row)) {
      throw new UserFacingError("Esta declaração já possui comprovante.");
    }

    const duplicate = await tx.paymentReceipt.findUnique({
      where: {
        chargeId_contentSha256: {
          chargeId: row.chargeId,
          contentSha256: stored.contentSha256,
        },
      },
    });
    if (duplicate && duplicate.id !== row.id) {
      throw new UserFacingError("Este comprovante já foi enviado para esta cobrança.");
    }

    const claimedAmountCents = row.claimedAmountCents;
    const updated = await tx.paymentReceipt.update({
      where: { id: row.id },
      data: {
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        originalFilename: input.originalFilename.slice(0, 180),
        contentSha256: stored.contentSha256,
        // Preserva claimedAmountCents
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PAYMENT_RECEIPT_UPLOADED",
      entityType: "PaymentReceipt",
      entityId: updated.id,
      after: {
        chargeId: row.chargeId,
        claimedAmountCents,
        hasReceipt: true,
        attachedLater: true,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
      },
    });

    return {
      receiptId: updated.id,
      status: updated.status,
      hasReceipt: true as const,
      claimedAmountCents,
    };
  });
}

/** @deprecated Prefer declarePlayerPayment. */
export async function uploadPaymentReceipt(
  viewer: Viewer,
  input: {
    chargeId: string;
    bytes: Buffer;
    mimeType: string;
    originalFilename: string;
    claimedAmountCents?: number | null;
  },
) {
  if (input.claimedAmountCents == null || input.claimedAmountCents <= 0) {
    throw new UserFacingError("Informe o valor pago.");
  }
  return declarePlayerPayment(viewer, {
    chargeId: input.chargeId,
    claimedAmountCents: input.claimedAmountCents,
    receipt: {
      bytes: input.bytes,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
    },
  });
}

export async function approvePaymentReceipt(
  viewer: Viewer,
  input: {
    receiptId: string;
    amountCents?: number;
    paidAt: Date;
    notes?: string | null;
    operationId: string;
  },
) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }

  const receipt = await withFinanceTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentReceipt" WHERE "id" = ${input.receiptId}::uuid FOR UPDATE`;
    const row = await tx.paymentReceipt.findFirst({
      where: { id: input.receiptId, groupId: viewer.group.id },
    });
    if (!row) throw new UserFacingError("Comprovante não encontrado.");
    if (row.status === "APPROVED") {
      return { already: true as const, row };
    }
    if (row.status !== "PENDING_REVIEW") {
      throw new UserFacingError("Só declarações aguardando revisão podem ser aprovadas.");
    }
    return { already: false as const, row };
  });

  if (receipt.already) {
    return {
      receiptId: receipt.row.id,
      paymentId: receipt.row.paymentId,
      alreadyApproved: true as const,
    };
  }

  const withoutFile = isDeclarationWithoutReceipt(receipt.row);
  const payment = await confirmPayment(viewer, {
    chargeId: receipt.row.chargeId,
    paidAt: input.paidAt,
    amountCents: input.amountCents ?? receipt.row.claimedAmountCents ?? undefined,
    method: "PIX",
    notes:
      input.notes ??
      (withoutFile
        ? `Declaração sem comprovante ${receipt.row.id}`
        : `Comprovante ${receipt.row.id}`),
    operationId: input.operationId,
  });

  // IdempotentOperation.operationId is UUID — derive a stable id from the payment op.
  const receiptOpId = createHash("sha256")
    .update(`PAYMENT_RECEIPT_APPROVE:${input.operationId}`)
    .digest("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const receiptHash = hashRequest({ receiptId: input.receiptId, paymentId: payment.paymentId });
  await withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: receiptOpId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_RECEIPT_APPROVE",
      requestHash: receiptHash,
      targetType: "PaymentReceipt",
      targetId: input.receiptId,
    });
    if (began.kind === "replay") return;

    await tx.paymentReceipt.update({
      where: { id: receipt.row.id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedByUserId: viewer.user.id,
        paymentId: payment.paymentId,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PAYMENT_RECEIPT_APPROVED",
      entityType: "PaymentReceipt",
      entityId: receipt.row.id,
      after: {
        chargeId: receipt.row.chargeId,
        paymentId: payment.paymentId,
        amountCents: payment.amountCents,
        hasReceipt: !withoutFile,
      },
    });
    await completeIdempotentOperation(tx, {
      operationId: receiptOpId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_RECEIPT_APPROVE",
      requestHash: receiptHash,
      targetType: "PaymentReceipt",
      targetId: input.receiptId,
      result: { paymentId: payment.paymentId },
    });
  });

  return {
    receiptId: receipt.row.id,
    paymentId: payment.paymentId,
    amountCents: payment.amountCents,
    remainingCents: payment.remainingCents,
    alreadyApproved: false as const,
  };
}

export async function rejectPaymentReceipt(
  viewer: Viewer,
  input: { receiptId: string; reason: string; operationId?: string },
) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = requireReason(input.reason, "Motivo da rejeição");
  const operationId = input.operationId || randomUUID();

  return withFinanceTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentReceipt" WHERE "id" = ${input.receiptId}::uuid FOR UPDATE`;
    const row = await tx.paymentReceipt.findFirst({
      where: { id: input.receiptId, groupId: viewer.group.id },
    });
    if (!row) throw new UserFacingError("Comprovante não encontrado.");
    if (row.status === "REJECTED") {
      return { receiptId: row.id, alreadyRejected: true as const };
    }
    if (row.status !== "PENDING_REVIEW") {
      throw new UserFacingError("Só declarações aguardando revisão podem ser rejeitadas.");
    }

    const requestHash = hashRequest({ receiptId: input.receiptId, reason });
    const began = await beginIdempotentOperation(tx, {
      operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_RECEIPT_REJECT",
      requestHash,
      targetType: "PaymentReceipt",
      targetId: input.receiptId,
    });
    if (began.kind === "replay") return began.result as { receiptId: string; alreadyRejected: boolean };

    await tx.paymentReceipt.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedByUserId: viewer.user.id,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PAYMENT_RECEIPT_REJECTED",
      entityType: "PaymentReceipt",
      entityId: row.id,
      reason,
      after: { chargeId: row.chargeId, hasReceipt: !isDeclarationWithoutReceipt(row) },
    });
    const result = { receiptId: row.id, alreadyRejected: false as const };
    await completeIdempotentOperation(tx, {
      operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_RECEIPT_REJECT",
      requestHash,
      targetType: "PaymentReceipt",
      targetId: input.receiptId,
      result,
    });
    return result;
  });
}
