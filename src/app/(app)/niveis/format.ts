import type { RatingAttribute } from "@/domain/ratings/attributes";
import {
  darkBadge,
  darkBadgeDanger,
  darkBadgeGold,
  darkBadgeInfo,
  darkBadgeSuccess,
  darkBadgeWarn,
} from "@/lib/ui/dark-surfaces";
import type { RatingProposalStatus } from "@/domain/ratings/proposalState";

export function formatRatingValue(value: number | null | undefined): string {
  if (value == null) return "Sem nota";
  return `${"★".repeat(value)}${"☆".repeat(5 - value)} (${value})`;
}

export function formatRatingChange(from: number | null, to: number): string {
  const left = from == null ? "Sem nota" : String(from);
  return `${left} → ${to}`;
}

/** Direction of a stored proposal snapshot (fromValue → toValue). */
export type RatingChangeDirection = "up" | "down" | "same" | "assign";

export function ratingChangeDirection(
  from: number | null,
  to: number,
): RatingChangeDirection {
  if (from == null) return "assign";
  if (to > from) return "up";
  if (to < from) return "down";
  return "same";
}

export function currentAttributeValue(
  target: {
    baseRating: number;
    attackRating: number | null;
    defenseRating: number | null;
    physicalRating: number | null;
  },
  attribute: RatingAttribute,
): number | null {
  switch (attribute) {
    case "OVERALL":
      return target.baseRating;
    case "ATTACK":
      return target.attackRating;
    case "DEFENSE":
      return target.defenseRating;
    case "PHYSICAL":
      return target.physicalRating;
  }
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_ADMIN_REVIEW: "Aguardando Admin",
  REJECTED_INITIAL: "Rejeitada (inicial)",
  OPEN_FOR_VOTING: "Em votação",
  VOTING_CLOSED: "Votação encerrada",
  APPLIED: "Aplicada",
  REJECTED_FINAL: "Rejeitada (final)",
  SUPERSEDED_STALE: "Obsoleta",
};

export function statusBadgeClass(status: RatingProposalStatus | string): string {
  switch (status) {
    case "OPEN_FOR_VOTING":
      return darkBadgeGold;
    case "PENDING_ADMIN_REVIEW":
      return darkBadgeWarn;
    case "VOTING_CLOSED":
      return darkBadgeInfo;
    case "APPLIED":
      return darkBadgeSuccess;
    case "REJECTED_INITIAL":
    case "REJECTED_FINAL":
      return darkBadgeDanger;
    case "SUPERSEDED_STALE":
      return darkBadge;
    default:
      return darkBadge;
  }
}

export function statusAccentBorder(status: RatingProposalStatus | string): string {
  switch (status) {
    case "OPEN_FOR_VOTING":
      return "border-l-smv-gold/70";
    case "PENDING_ADMIN_REVIEW":
      return "border-l-amber-300/70";
    case "VOTING_CLOSED":
      return "border-l-sky-300/70";
    case "APPLIED":
      return "border-l-emerald-400/60";
    case "REJECTED_INITIAL":
    case "REJECTED_FINAL":
      return "border-l-red-400/70";
    default:
      return "border-l-white/20";
  }
}
