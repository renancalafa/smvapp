/**
 * Avaliação unificada Admin: Overall + Attack + Defense + Physical + preferredRole
 * em UMA transação. Usa o writer compartilhado e o editor de papel com Tx.
 */
import "server-only";

import type { PreferredRole, RatingAttribute } from "@/domain/ratings/attributes";
import { isValidNullableRatingValue, isValidRatingValue } from "@/domain/ratings/attributes";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import {
  applyMemberRatingWithTx,
  type ApplyMemberRatingResult,
} from "./apply-rating";
import {
  changeMemberPreferredRoleWithTx,
  type ChangePreferredRoleResult,
} from "./preferred-role";

export type MemberEvaluationSnapshot = {
  overall: number;
  attack: number | null;
  defense: number | null;
  physical: number | null;
  preferredRole: PreferredRole | null;
};

export type ApplyMemberEvaluationInput = {
  memberId: string;
  /** Valores desejados (todos os campos). */
  next: MemberEvaluationSnapshot;
  /** Snapshot que o Admin viu ao abrir o formulário — detecta edição concorrente. */
  expected: MemberEvaluationSnapshot;
  reason: string;
};

export type ApplyMemberEvaluationResult = {
  unchanged: boolean;
  ratingChanges: Array<{
    attribute: RatingAttribute;
    result: ApplyMemberRatingResult;
  }>;
  preferredRole: ChangePreferredRoleResult | null;
};

function sameNullable(a: number | null, b: number | null): boolean {
  return a === b;
}

function sameRole(a: PreferredRole | null, b: PreferredRole | null): boolean {
  return a === b;
}

function validateSnapshot(label: string, snap: MemberEvaluationSnapshot): void {
  if (!isValidRatingValue(snap.overall)) {
    throw new UserFacingError(`${label}: a nota geral deve ser um inteiro de 1 a 5.`);
  }
  if (!isValidNullableRatingValue(snap.attack)) {
    throw new UserFacingError(`${label}: ataque inválido.`);
  }
  if (!isValidNullableRatingValue(snap.defense)) {
    throw new UserFacingError(`${label}: defesa inválida.`);
  }
  if (!isValidNullableRatingValue(snap.physical)) {
    throw new UserFacingError(`${label}: físico inválido.`);
  }
}

export async function applyMemberEvaluation(
  viewer: Viewer,
  input: ApplyMemberEvaluationInput,
): Promise<ApplyMemberEvaluationResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  validateSnapshot("Avaliação", input.next);
  validateSnapshot("Estado esperado", input.expected);

  return db.$transaction(async (tx) => {
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
        preferredRole: true,
      },
    });

    const current: MemberEvaluationSnapshot = {
      overall: member.baseRating,
      attack: member.attackRating,
      defense: member.defenseRating,
      physical: member.physicalRating,
      preferredRole: member.preferredRole,
    };

    const expectedMatches =
      current.overall === input.expected.overall &&
      sameNullable(current.attack, input.expected.attack) &&
      sameNullable(current.defense, input.expected.defense) &&
      sameNullable(current.physical, input.expected.physical) &&
      sameRole(current.preferredRole, input.expected.preferredRole);

    if (!expectedMatches) {
      throw new UserFacingError(
        "O jogador foi alterado por outra pessoa. Recarregue a página e tente de novo.",
      );
    }

    const ratingPlan: Array<{ attribute: RatingAttribute; newValue: number | null }> = [];
    if (current.overall !== input.next.overall) {
      ratingPlan.push({ attribute: "OVERALL", newValue: input.next.overall });
    }
    if (!sameNullable(current.attack, input.next.attack)) {
      ratingPlan.push({ attribute: "ATTACK", newValue: input.next.attack });
    }
    if (!sameNullable(current.defense, input.next.defense)) {
      ratingPlan.push({ attribute: "DEFENSE", newValue: input.next.defense });
    }
    if (!sameNullable(current.physical, input.next.physical)) {
      ratingPlan.push({ attribute: "PHYSICAL", newValue: input.next.physical });
    }
    const roleChanged = !sameRole(current.preferredRole, input.next.preferredRole);

    if (ratingPlan.length === 0 && !roleChanged) {
      return { unchanged: true, ratingChanges: [], preferredRole: null };
    }

    const reason = (input.reason ?? "").trim();
    if (!reason) throw new UserFacingError("Motivo é obrigatório.");

    const ratingChanges: ApplyMemberEvaluationResult["ratingChanges"] = [];
    for (const step of ratingPlan) {
      const result = await applyMemberRatingWithTx(tx, viewer, {
        memberId: input.memberId,
        attribute: step.attribute,
        newValue: step.newValue,
        reason,
        source: "ADMIN_DIRECT",
        supersedeActiveProposals: true,
      });
      ratingChanges.push({ attribute: step.attribute, result });
    }

    let preferredRole: ChangePreferredRoleResult | null = null;
    if (roleChanged) {
      preferredRole = await changeMemberPreferredRoleWithTx(tx, viewer, {
        memberId: input.memberId,
        preferredRole: input.next.preferredRole,
        reason,
      });
    }

    return { unchanged: false, ratingChanges, preferredRole };
  });
}
