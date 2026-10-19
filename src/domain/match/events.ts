/** Tipos de MatchEvent (espelha o enum Prisma; domínio puro). */
export type MatchEventType =
  | "GOAL"
  | "OWN_GOAL"
  | "BIG_MISS"
  | "YELLOW_CARD"
  | "BLUE_CARD"
  | "RED_CARD"
  | "HIT_WOODWORK"
  | "TACKLE";

/** Tipos que alteram o placar. */
export const SCORING_EVENT_TYPES = ["GOAL", "OWN_GOAL"] as const satisfies readonly MatchEventType[];

/** Eventos individuais via toque no nome do jogador (não no placar). */
export const PLAYER_EVENT_TYPES = [
  "YELLOW_CARD",
  "BLUE_CARD",
  "RED_CARD",
  "BIG_MISS",
  "HIT_WOODWORK",
  "TACKLE",
] as const satisfies readonly MatchEventType[];

export type PlayerEventType = (typeof PLAYER_EVENT_TYPES)[number];

export const ALL_MATCH_EVENT_TYPES = [
  "GOAL",
  "OWN_GOAL",
  "BIG_MISS",
  "YELLOW_CARD",
  "BLUE_CARD",
  "RED_CARD",
  "HIT_WOODWORK",
  "TACKLE",
] as const satisfies readonly MatchEventType[];

export const MATCH_EVENT_LABELS: Record<MatchEventType, string> = {
  GOAL: "Gol",
  OWN_GOAL: "Gol contra",
  BIG_MISS: "Pixotada",
  YELLOW_CARD: "Cartão amarelo",
  BLUE_CARD: "Cartão azul",
  RED_CARD: "Cartão vermelho",
  HIT_WOODWORK: "Bola na trave",
  TACKLE: "Desarme",
};

export function isMatchEventType(value: string): value is MatchEventType {
  return (ALL_MATCH_EVENT_TYPES as readonly string[]).includes(value);
}

export function isPlayerEventType(value: string): value is PlayerEventType {
  return (PLAYER_EVENT_TYPES as readonly string[]).includes(value);
}
