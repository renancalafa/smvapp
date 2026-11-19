/**
 * Writer compartilhado de notas (Overall / Attack / Defense / Physical).
 * Atualiza GroupMember + MemberRatingHistory + AuditLog atomicamente.
 * Marca propostas ativas conflitantes como SUPERSEDED_STALE.
 * Não recalcula sorteios existentes (snapshots permanecem).
 */
import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  attributeFieldData,
  isValidNullableRatingValue,
  isValidRatingValue,
  readAttributeValue,
  type MemberRatingChangeSource,
  type RatingAttribute,
} from "@/domain/ratings/attributes";
import { ACTIVE_PROPOSAL_STATUSES } from "@/domain/ratings/proposalState";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { db } from "@/server/db";

export type ApplyMemberRatingInput = {
  memberId: string;
  attribute: RatingAttribute;
  /** Overall: 1–5. Attack/Defense/Physical: 1–5 ou null (limpar). */
  newValue: number | null;
  reason: string;
  source: MemberRatingChangeSource;
  /** Quando a aplicação vem de proposta finalizada. */
  proposalId?: string;
  /**
   * Se true (padrão em ADMIN_DIRECT), marca propostas ativas do mesmo atributo como stale.
   * Em PROPOSAL_APPLIED a própria proposta já sai do conjunto ativo.
   */
  supersedeActiveProposals?: boolean;
};

export type ApplyMemberRatingResult = {
  previousValue: number | null;
  newValue: number | null;
  unchanged: boolean;
  historyId: string | null;
  supersededProposalIds: string[];
};

function requireReason(raw: string | null | undefined, label: string): string {
  const reason = (raw ?? "").trim();
  if (!reason) throw new UserFacingError(`${label} é obrigatório.`);
  return reason;
}

type Tx = Prisma.TransactionClient;

async function applyMemberRatingInTx(
  tx: Tx,
  viewer: Viewer,
  input: ApplyMemberRatingInput,
): Promise<ApplyMemberRatingResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (input.attribute === "OVERALL") {
    if (!isValidRatingValue(input.newValue)) {
      throw new UserFacingError("A nota geral deve ser um inteiro de 1 a 5.");
    }
  } else if (!isValidNullableRatingValue(input.newValue)) {
    throw new UserFacingError("A nota deve ser um inteiro de 1 a 5, ou sem nota.");
  }
  const reason = requireReason(input.reason, "Motivo");

  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "GroupMember"
    WHERE "id" = ${input.memberId}::uuid AND "groupId" = ${viewer.group.id}::uuid
    FOR UPDATE`;
  if (locked.length === 0) throw new UserFacingError("Jogador não encontrado.");

  const member = await tx.groupMember.findUniqueOrThrow({
    where: { id: input.memberId },
    select: {
      id: true,
      baseRating: true,
      attackRating: true,
      defenseRating: true,
      physicalRating: true,
      role: true,
      modality: true,
      status: true,
      userId: true,
      user: { select: { username: true, name: true } },
    },
  });

  const previousValue = readAttributeValue(member, input.attribute);
  if (previousValue === input.newValue) {
    return {
      previousValue,
      newValue: input.newValue,
      unchanged: true,
      historyId: null,
      supersededProposalIds: [],
    };
  }

  const data = attributeFieldData(input.attribute, input.newValue);
  const whereOptimistic =
    input.attribute === "OVERALL"
      ? { id: member.id, baseRating: member.baseRating }
      : input.attribute === "ATTACK"
        ? { id: member.id, attackRating: member.attackRating }
        : input.attribute === "DEFENSE"
          ? { id: member.id, defenseRating: member.defenseRating }
          : { id: member.id, physicalRating: member.physicalRating };

  const updated = await tx.groupMember.updateMany({
    where: whereOptimistic,
    data,
  });
  if (updated.count !== 1) {
    throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");
  }

  const history = await tx.memberRatingHistory.create({
    data: {
      groupId: viewer.group.id,
      memberId: member.id,
      attribute: input.attribute,
      previousValue,
      newValue: input.newValue,
      source: input.source,
      actorUserId: viewer.user.id,
      reason,
      proposalId: input.proposalId ?? null,
    },
    select: { id: true },
  });

  const beforePayload =
    input.attribute === "OVERALL"
      ? { attribute: input.attribute, value: previousValue, baseRating: previousValue }
      : { attribute: input.attribute, value: previousValue };
  const afterPayload =
    input.attribute === "OVERALL"
      ? {
          attribute: input.attribute,
          value: input.newValue,
          source: input.source,
          baseRating: input.newValue,
        }
      : { attribute: input.attribute, value: input.newValue, source: input.source };

  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "MEMBER_RATING_CHANGED",
    entityType: "GroupMember",
    entityId: member.id,
    reason,
    before: beforePayload,
    after: afterPayload,
    metadata: {
      targetUserId: member.userId,
      targetUsername: member.user.username,
      targetName: member.user.name,
      actorUsername: viewer.user.username,
      role: member.role,
      modality: member.modality,
      status: member.status,
      attribute: input.attribute,
      source: input.source,
      proposalId: input.proposalId ?? null,
    },
  });

  const supersede = input.supersedeActiveProposals !== false;
  const supersededProposalIds: string[] = [];
  if (supersede) {
    const active = await tx.ratingChangeProposal.findMany({
      where: {
        groupId: viewer.group.id,
        targetMemberId: member.id,
        attribute: input.attribute,
        status: { in: [...ACTIVE_PROPOSAL_STATUSES] },
        ...(input.proposalId ? { id: { not: input.proposalId } } : {}),
      },
      select: { id: true },
    });
    if (active.length) {
      await tx.ratingChangeProposal.updateMany({
        where: { id: { in: active.map((p) => p.id) } },
        data: {
          status: "SUPERSEDED_STALE",
          blocksDuplicate: false,
          finalDecisionReason: `Nota alterada diretamente (${input.source}); proposta tornada obsoleta.`,
          finalDecidedAt: new Date(),
          finalDecidedByUserId: viewer.user.id,
        },
      });
      for (const p of active) {
        supersededProposalIds.push(p.id);
        await writeAuditLog(tx, {
          groupId: viewer.group.id,
          actorUserId: viewer.user.id,
          action: "RATING_PROPOSAL_SUPERSEDED",
          entityType: "RatingChangeProposal",
          entityId: p.id,
          reason: "Conflito com alteração direta de nota",
          after: { status: "SUPERSEDED_STALE", attribute: input.attribute },
        });
      }
    }
  }

  return {
    previousValue,
    newValue: input.newValue,
    unchanged: false,
    historyId: history.id,
    supersededProposalIds,
  };
}

/**
 * Aplica nota dentro de uma transação já aberta (ex.: finalização de proposta).
 */
export async function applyMemberRatingWithTx(
  tx: Tx,
  viewer: Viewer,
  input: ApplyMemberRatingInput,
): Promise<ApplyMemberRatingResult> {
  return applyMemberRatingInTx(tx, viewer, input);
}

/**
 * Entrada principal para Admin (direto ou atribuição inicial).
 */
export async function applyMemberRating(
  viewer: Viewer,
  input: ApplyMemberRatingInput,
): Promise<ApplyMemberRatingResult> {
  return db.$transaction((tx) => applyMemberRatingInTx(tx, viewer, input));
}
