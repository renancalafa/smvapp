/**
 * Atributos de nota do jogador e mapeamento para colunas de GroupMember.
 * Puro — sem I/O.
 */

export const RATING_ATTRIBUTES = ["OVERALL", "ATTACK", "DEFENSE", "PHYSICAL"] as const;
export type RatingAttribute = (typeof RATING_ATTRIBUTES)[number];

export const PREFERRED_ROLES = ["ATTACKER", "DEFENDER", "VERSATILE"] as const;
export type PreferredRole = (typeof PREFERRED_ROLES)[number];

export const MEMBER_RATING_CHANGE_SOURCES = [
  "ADMIN_DIRECT",
  "ADMIN_INITIAL_ASSIGN",
  "PROPOSAL_APPLIED",
] as const;
export type MemberRatingChangeSource = (typeof MEMBER_RATING_CHANGE_SOURCES)[number];

/** Coluna em GroupMember para cada atributo votável. */
export const RATING_ATTRIBUTE_FIELD = {
  OVERALL: "baseRating",
  ATTACK: "attackRating",
  DEFENSE: "defenseRating",
  PHYSICAL: "physicalRating",
} as const satisfies Record<RatingAttribute, string>;

export type RatingAttributeField = (typeof RATING_ATTRIBUTE_FIELD)[RatingAttribute];

export type MemberRatingSnapshot = {
  baseRating: number;
  attackRating: number | null;
  defenseRating: number | null;
  physicalRating: number | null;
};

export function isRatingAttribute(value: string): value is RatingAttribute {
  return (RATING_ATTRIBUTES as readonly string[]).includes(value);
}

export function isPreferredRole(value: string): value is PreferredRole {
  return (PREFERRED_ROLES as readonly string[]).includes(value);
}

/** Nota válida: inteiro 1–5. */
export function isValidRatingValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Nullable: null/undefined ou 1–5. */
export function isValidNullableRatingValue(value: unknown): value is number | null {
  if (value === null || value === undefined) return true;
  return isValidRatingValue(value);
}

export function readAttributeValue(
  member: MemberRatingSnapshot,
  attribute: RatingAttribute,
): number | null {
  switch (attribute) {
    case "OVERALL":
      return member.baseRating;
    case "ATTACK":
      return member.attackRating;
    case "DEFENSE":
      return member.defenseRating;
    case "PHYSICAL":
      return member.physicalRating;
  }
}

export function attributeFieldData(
  attribute: RatingAttribute,
  value: number | null,
): Partial<MemberRatingSnapshot> {
  switch (attribute) {
    case "OVERALL":
      if (value == null) {
        throw new Error("Overall (baseRating) não pode ser null.");
      }
      return { baseRating: value };
    case "ATTACK":
      return { attackRating: value };
    case "DEFENSE":
      return { defenseRating: value };
    case "PHYSICAL":
      return { physicalRating: value };
  }
}

export function ratingAttributeLabel(attribute: RatingAttribute): string {
  switch (attribute) {
    case "OVERALL":
      return "Nota geral";
    case "ATTACK":
      return "Ataque";
    case "DEFENSE":
      return "Defesa";
    case "PHYSICAL":
      return "Físico";
  }
}
