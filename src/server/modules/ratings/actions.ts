"use server";

import { refresh } from "next/cache";
import {
  isPreferredRole,
  isRatingAttribute,
  isValidNullableRatingValue,
  isValidRatingValue,
  type PreferredRole,
} from "@/domain/ratings/attributes";
import type { RatingVoteChoice } from "@/domain/ratings/proposalState";
import { requireAdminAction, requireViewer } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { getFinancialAccessForViewer } from "@/server/modules/finance/access";
import { isUuid } from "@/server/modules/members/validation";
import { applyMemberEvaluation } from "./apply-evaluation";
import { applyMemberRating } from "./apply-rating";
import { changeMemberPreferredRole } from "./preferred-role";
import {
  castRatingProposalVote,
  closeRatingProposalVoting,
  createRatingProposal,
  finalizeRatingProposal,
  reviewRatingProposalInitial,
  withdrawRatingProposalVote,
} from "./proposals";

export type RatingsActionState =
  | { status: "error"; error: string }
  | { status: "done"; message: string }
  | undefined;

const UNEXPECTED = "Não foi possível concluir agora. Tente novamente em instantes.";

function errorMessage(scope: string, error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(scope, error);
  return UNEXPECTED;
}

async function requireRatingsViewer() {
  const viewer = await requireViewer();
  const access = await getFinancialAccessForViewer(viewer);
  if (access.mode === "payment_restricted") {
    throw new UserFacingError(
      "Acesso restrito por pendência financeira. Regularize em Pagamentos.",
    );
  }
  return viewer;
}

export async function createRatingProposalAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireRatingsViewer();
    const targetMemberId = formText(formData, "targetMemberId");
    const attributeRaw = formText(formData, "attribute");
    const toValue = Number(formText(formData, "toValue"));
    const reason = formText(formData, "reason");
    if (!isUuid(targetMemberId) || !isRatingAttribute(attributeRaw) || !isValidRatingValue(toValue)) {
      return { status: "error", error: "Preencha jogador, atributo e nota de 1 a 5." };
    }
    await createRatingProposal(viewer, {
      targetMemberId,
      attribute: attributeRaw,
      toValue,
      reason,
    });
    refresh();
    return { status: "done", message: "Sugestão enviada. Aguarde a revisão do administrador." };
  } catch (error) {
    return { status: "error", error: errorMessage("createRatingProposalAction", error) };
  }
}

export async function reviewRatingProposalAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const proposalId = formText(formData, "proposalId");
    const decision = formText(formData, "decision");
    const reason = formText(formData, "reason");
    if (!isUuid(proposalId) || (decision !== "APPROVE" && decision !== "REJECT")) {
      return { status: "error", error: "Pedido inválido." };
    }
    const result = await reviewRatingProposalInitial(viewer, {
      proposalId,
      decision,
      reason: decision === "REJECT" ? reason : reason || undefined,
    });
    refresh();
    return {
      status: "done",
      message:
        result.status === "OPEN_FOR_VOTING"
          ? "Sugestão aprovada — votação aberta."
          : "Sugestão rejeitada.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("reviewRatingProposalAction", error) };
  }
}

export async function castRatingVoteAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireRatingsViewer();
    const proposalId = formText(formData, "proposalId");
    const choiceRaw = formText(formData, "choice");
    if (!isUuid(proposalId) || (choiceRaw !== "FOR" && choiceRaw !== "AGAINST")) {
      return { status: "error", error: "Voto inválido." };
    }
    const choice = choiceRaw as RatingVoteChoice;
    const result = await castRatingProposalVote(viewer, { proposalId, choice });
    refresh();
    return {
      status: "done",
      message: result.changed
        ? choice === "FOR"
          ? "Voto a favor registrado."
          : "Voto contra registrado."
        : "Seu voto já estava assim.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("castRatingVoteAction", error) };
  }
}

export async function withdrawRatingVoteAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireRatingsViewer();
    const proposalId = formText(formData, "proposalId");
    if (!isUuid(proposalId)) return { status: "error", error: "Pedido inválido." };
    const result = await withdrawRatingProposalVote(viewer, { proposalId });
    refresh();
    return {
      status: "done",
      message: result.withdrawn ? "Voto retirado." : "Você ainda não tinha votado.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("withdrawRatingVoteAction", error) };
  }
}

export async function closeRatingVotingAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const proposalId = formText(formData, "proposalId");
    if (!isUuid(proposalId)) return { status: "error", error: "Pedido inválido." };
    const result = await closeRatingProposalVoting(viewer, { proposalId });
    refresh();
    return {
      status: "done",
      message: `Votação encerrada (${result.forCount} a favor, ${result.againstCount} contra).`,
    };
  } catch (error) {
    return { status: "error", error: errorMessage("closeRatingVotingAction", error) };
  }
}

export async function finalizeRatingProposalAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const proposalId = formText(formData, "proposalId");
    const decision = formText(formData, "decision");
    const reason = formText(formData, "reason");
    if (!isUuid(proposalId) || (decision !== "APPLY" && decision !== "REJECT")) {
      return { status: "error", error: "Pedido inválido." };
    }
    const result = await finalizeRatingProposal(viewer, {
      proposalId,
      decision,
      reason,
    });
    refresh();
    return {
      status: "done",
      message:
        result.status === "APPLIED"
          ? "Nota atualizada conforme a proposta."
          : "Proposta rejeitada na decisão final.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("finalizeRatingProposalAction", error) };
  }
}

function parseNullableRatingField(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "NONE" || trimmed === "CLEAR") return null;
  const value = Number(trimmed);
  if (!isValidRatingValue(value)) return "invalid";
  return value;
}

function parsePreferredRoleField(raw: string): PreferredRole | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "NONE") return null;
  if (isPreferredRole(trimmed)) return trimmed;
  return "invalid";
}

function parseExpectedNullable(raw: string): number | null | "invalid" {
  return parseNullableRatingField(raw);
}

export async function applyMemberAttributeAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const memberId = formText(formData, "memberId");
    const attributeRaw = formText(formData, "attribute");
    const rawValue = formText(formData, "newValue");
    const reason = formText(formData, "reason");
    const sourceRaw = formText(formData, "source") || "ADMIN_DIRECT";
    if (!isUuid(memberId) || !isRatingAttribute(attributeRaw)) {
      return { status: "error", error: "Escolha atributo e nota de 1 a 5." };
    }
    const newValue =
      attributeRaw === "OVERALL"
        ? (() => {
            const n = Number(rawValue);
            return isValidRatingValue(n) ? n : ("invalid" as const);
          })()
        : parseNullableRatingField(rawValue);
    if (newValue === "invalid" || (attributeRaw === "OVERALL" && newValue === null)) {
      return { status: "error", error: "Escolha atributo e nota de 1 a 5." };
    }
    if (attributeRaw !== "OVERALL" && !isValidNullableRatingValue(newValue)) {
      return { status: "error", error: "Escolha atributo e nota de 1 a 5." };
    }
    const source =
      sourceRaw === "ADMIN_INITIAL_ASSIGN" ? "ADMIN_INITIAL_ASSIGN" : "ADMIN_DIRECT";
    const result = await applyMemberRating(viewer, {
      memberId,
      attribute: attributeRaw,
      newValue,
      reason,
      source,
    });
    refresh();
    if (result.unchanged) {
      return { status: "done", message: "A nota já estava atualizada." };
    }
    return {
      status: "done",
      message: `Nota atualizada${result.previousValue == null ? "" : ` de ${result.previousValue}`} para ${result.newValue ?? "sem nota"}.`,
    };
  } catch (error) {
    return { status: "error", error: errorMessage("applyMemberAttributeAction", error) };
  }
}

/** Avaliação unificada: notas + papel preferido numa única operação atômica. */
export async function applyMemberEvaluationAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const memberId = formText(formData, "memberId");
    if (!isUuid(memberId)) return { status: "error", error: "Jogador inválido." };

    const overall = Number(formText(formData, "overall"));
    const attack = parseNullableRatingField(formText(formData, "attack"));
    const defense = parseNullableRatingField(formText(formData, "defense"));
    const physical = parseNullableRatingField(formText(formData, "physical"));
    const preferredRole = parsePreferredRoleField(formText(formData, "preferredRole"));

    const expectedOverall = Number(formText(formData, "expectedOverall"));
    const expectedAttack = parseExpectedNullable(formText(formData, "expectedAttack"));
    const expectedDefense = parseExpectedNullable(formText(formData, "expectedDefense"));
    const expectedPhysical = parseExpectedNullable(formText(formData, "expectedPhysical"));
    const expectedPreferredRole = parsePreferredRoleField(
      formText(formData, "expectedPreferredRole"),
    );

    if (
      !isValidRatingValue(overall) ||
      attack === "invalid" ||
      defense === "invalid" ||
      physical === "invalid" ||
      preferredRole === "invalid" ||
      !isValidRatingValue(expectedOverall) ||
      expectedAttack === "invalid" ||
      expectedDefense === "invalid" ||
      expectedPhysical === "invalid" ||
      expectedPreferredRole === "invalid"
    ) {
      return { status: "error", error: "Revise as notas e o papel preferido." };
    }

    const result = await applyMemberEvaluation(viewer, {
      memberId,
      reason: formText(formData, "reason"),
      next: {
        overall,
        attack,
        defense,
        physical,
        preferredRole,
      },
      expected: {
        overall: expectedOverall,
        attack: expectedAttack,
        defense: expectedDefense,
        physical: expectedPhysical,
        preferredRole: expectedPreferredRole,
      },
    });

    refresh();
    if (result.unchanged) {
      return { status: "error", error: "Nenhuma alteração para salvar." };
    }

    const parts: string[] = [];
    for (const change of result.ratingChanges) {
      if (change.result.unchanged) continue;
      parts.push(
        `${change.attribute}: ${change.result.previousValue ?? "—"}→${change.result.newValue ?? "sem nota"}`,
      );
    }
    if (result.preferredRole && !result.preferredRole.unchanged) {
      parts.push("papel preferido");
    }
    return {
      status: "done",
      message: parts.length ? `Avaliação atualizada (${parts.join(", ")}).` : "Avaliação atualizada.",
    };
  } catch (error) {
    return { status: "error", error: errorMessage("applyMemberEvaluationAction", error) };
  }
}

export async function changePreferredRoleAction(
  _previous: RatingsActionState,
  formData: FormData,
): Promise<RatingsActionState> {
  try {
    const viewer = await requireAdminAction();
    const memberId = formText(formData, "memberId");
    const roleRaw = formText(formData, "preferredRole");
    const reason = formText(formData, "reason");
    if (!isUuid(memberId)) return { status: "error", error: "Jogador inválido." };
    const preferredRole =
      roleRaw === "" || roleRaw === "NONE"
        ? null
        : isPreferredRole(roleRaw)
          ? roleRaw
          : null;
    if (roleRaw !== "" && roleRaw !== "NONE" && preferredRole === null) {
      return { status: "error", error: "Papel preferido inválido." };
    }
    const result = await changeMemberPreferredRole(viewer, {
      memberId,
      preferredRole,
      reason,
    });
    refresh();
    if (result.unchanged) {
      return { status: "done", message: "O papel preferido já estava assim." };
    }
    return { status: "done", message: "Papel preferido atualizado." };
  } catch (error) {
    return { status: "error", error: errorMessage("changePreferredRoleAction", error) };
  }
}
