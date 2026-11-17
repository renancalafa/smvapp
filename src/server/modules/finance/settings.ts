import "server-only";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { withFinanceTransaction } from "./lock";

const PIX_TYPES = new Set(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]);

export type FinanceSettingsInput = {
  dailyFeeCents?: number;
  monthlyFieldCostCents?: number;
  fieldPaymentDueDay?: number;
  monthlyFeeDueDay?: number;
  pixKey?: string | null;
  pixKeyType?: string | null;
  pixBeneficiaryName?: string | null;
  /** IANA timezone; altera Group.timezone (não reescreve ciclos já criados). */
  timezone?: string;
};

function normalizePix(input: FinanceSettingsInput): {
  pixKey: string | null;
  pixKeyType: string | null;
  pixBeneficiaryName: string | null;
} | undefined {
  if (
    input.pixKey === undefined &&
    input.pixKeyType === undefined &&
    input.pixBeneficiaryName === undefined
  ) {
    return undefined;
  }
  const key = input.pixKey === undefined ? undefined : input.pixKey?.trim() || null;
  const type = input.pixKeyType === undefined ? undefined : input.pixKeyType?.trim() || null;
  const name =
    input.pixBeneficiaryName === undefined ? undefined : input.pixBeneficiaryName?.trim() || null;

  // Se qualquer um veio, os três precisam fechar o CHECK (todos nulos ou todos preenchidos).
  const resolvedKey = key === undefined ? null : key;
  const resolvedType = type === undefined ? null : type;
  const resolvedName = name === undefined ? null : name;

  const allNull = resolvedKey === null && resolvedType === null && resolvedName === null;
  if (allNull) return { pixKey: null, pixKeyType: null, pixBeneficiaryName: null };

  if (!resolvedKey || !resolvedType || !resolvedName) {
    throw new UserFacingError("PIX exige chave, tipo e nome do beneficiário (ou limpar os três).");
  }
  if (!PIX_TYPES.has(resolvedType)) {
    throw new UserFacingError("Tipo de chave PIX inválido.");
  }
  return { pixKey: resolvedKey, pixKeyType: resolvedType, pixBeneficiaryName: resolvedName };
}

/**
 * Atualiza configuração financeira corrente. Não reescreve fieldCostSnapshotCents
 * nem valores congelados de ciclos já existentes.
 */
export async function updateFinanceSettings(viewer: Viewer, input: FinanceSettingsInput): Promise<void> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }

  if (input.dailyFeeCents !== undefined) {
    if (!Number.isInteger(input.dailyFeeCents) || input.dailyFeeCents <= 0) {
      throw new UserFacingError("Valor da diária deve ser um inteiro > 0.");
    }
  }
  if (input.monthlyFieldCostCents !== undefined) {
    if (!Number.isInteger(input.monthlyFieldCostCents) || input.monthlyFieldCostCents < 0) {
      throw new UserFacingError("Custo mensal do campo inválido.");
    }
  }
  for (const [label, day] of [
    ["fieldPaymentDueDay", input.fieldPaymentDueDay],
    ["monthlyFeeDueDay", input.monthlyFeeDueDay],
  ] as const) {
    if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > 31)) {
      throw new UserFacingError(`${label} deve ser entre 1 e 31.`);
    }
  }

  const pix = normalizePix(input);
  let nextTimezone: string | undefined;
  if (input.timezone !== undefined) {
    const tz = input.timezone.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new UserFacingError("Fuso horário IANA inválido.");
    }
    nextTimezone = tz;
  }

  await withFinanceTransaction(async (tx) => {
    const current = await tx.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
      select: {
        dailyFeeCents: true,
        monthlyFieldCostCents: true,
        fieldPaymentDueDay: true,
        monthlyFeeDueDay: true,
        pixKey: true,
        pixKeyType: true,
        pixBeneficiaryName: true,
      },
    });
    if (!current) throw new UserFacingError("Configurações do grupo não encontradas.");
    const group = await tx.group.findUniqueOrThrow({
      where: { id: viewer.group.id },
      select: { timezone: true },
    });

    const after = {
      dailyFeeCents: input.dailyFeeCents ?? current.dailyFeeCents,
      monthlyFieldCostCents: input.monthlyFieldCostCents ?? current.monthlyFieldCostCents,
      fieldPaymentDueDay: input.fieldPaymentDueDay ?? current.fieldPaymentDueDay,
      monthlyFeeDueDay: input.monthlyFeeDueDay ?? current.monthlyFeeDueDay,
      pixKey: pix ? pix.pixKey : current.pixKey,
      pixKeyType: pix ? pix.pixKeyType : current.pixKeyType,
      pixBeneficiaryName: pix ? pix.pixBeneficiaryName : current.pixBeneficiaryName,
    };
    const timezoneAfter = nextTimezone ?? group.timezone;

    const unchanged =
      after.dailyFeeCents === current.dailyFeeCents &&
      after.monthlyFieldCostCents === current.monthlyFieldCostCents &&
      after.fieldPaymentDueDay === current.fieldPaymentDueDay &&
      after.monthlyFeeDueDay === current.monthlyFeeDueDay &&
      after.pixKey === current.pixKey &&
      after.pixKeyType === current.pixKeyType &&
      after.pixBeneficiaryName === current.pixBeneficiaryName &&
      timezoneAfter === group.timezone;
    if (unchanged) return;

    await tx.groupSettings.update({
      where: { groupId: viewer.group.id },
      data: { ...after, updatedByUserId: viewer.user.id },
    });
    if (timezoneAfter !== group.timezone) {
      await tx.group.update({
        where: { id: viewer.group.id },
        data: { timezone: timezoneAfter },
      });
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "GROUP_SETTINGS_UPDATED",
      entityType: "GroupSettings",
      entityId: viewer.group.id,
      before: { ...current, timezone: group.timezone },
      after: { ...after, timezone: timezoneAfter },
      metadata: { section: "finance" },
    });
  });
}

/**
 * Define/remove isenção financeira por memberId estável (nunca por nome).
 * ADMIN sem feeExempt continua pagando.
 */
export async function setMemberFeeExempt(
  viewer: Viewer,
  memberId: string,
  feeExempt: boolean,
  reason: string | null,
): Promise<void> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const trimmedReason = reason?.trim() || null;
  if (feeExempt && !trimmedReason) {
    throw new UserFacingError("Motivo da isenção obrigatório.");
  }

  await withFinanceTransaction(async (tx) => {
    const member = await tx.groupMember.findFirst({
      where: { id: memberId, groupId: viewer.group.id },
      select: {
        id: true,
        feeExempt: true,
        feeExemptReason: true,
        modality: true,
        userId: true,
        user: { select: { username: true, name: true } },
      },
    });
    if (!member) throw new UserFacingError("Jogador não encontrado.");
    if (member.feeExempt === feeExempt && (member.feeExemptReason ?? null) === trimmedReason) {
      return;
    }

    const now = new Date();
    await tx.groupMember.update({
      where: { id: member.id },
      data: {
        feeExempt,
        feeExemptReason: feeExempt ? trimmedReason : null,
        feeExemptUpdatedAt: now,
        feeExemptUpdatedByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "MEMBER_FEE_EXEMPT_CHANGED",
      entityType: "GroupMember",
      entityId: member.id,
      before: { feeExempt: member.feeExempt, feeExemptReason: member.feeExemptReason },
      after: { feeExempt, feeExemptReason: feeExempt ? trimmedReason : null },
      reason: trimmedReason ?? undefined,
      metadata: {
        targetUserId: member.userId,
        targetUsername: member.user.username,
        targetName: member.user.name,
        modality: member.modality,
      },
    });
  });
}
