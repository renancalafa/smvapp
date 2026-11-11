/**
 * Identidade visual estável dos times REGULAR do Rei da Mesa.
 *
 * Chave: `initialQueuePosition` / `DrawTeam.position` (1–4), NÃO o UUID.
 * Histórico "Time N" e sessões novas compartilham o mesmo mapa de posição.
 * ROTATION_POOL permanece "Rotativos" (sem camisa).
 */

export const TEAM_JERSEY_POSITIONS = [1, 2, 3, 4] as const;
export type TeamJerseyPosition = (typeof TEAM_JERSEY_POSITIONS)[number];

export type TeamJersey = {
  position: TeamJerseyPosition;
  /** Nome de camisa exibido na UI. */
  name: "Branco" | "Azul" | "Preto" | "Vermelho";
  /** Hex persistido em SessionTeam.color / DrawTeam.color. */
  hex: string;
  /** Texto sobre o badge (contraste). */
  textOnBadge: string;
  /** Borda visível (Preto/Branco no fundo navy). */
  ring: string;
};

export const TEAM_JERSEYS: Record<TeamJerseyPosition, TeamJersey> = {
  1: {
    position: 1,
    name: "Branco",
    hex: "#F3F4F6",
    textOnBadge: "#0B1C2C",
    ring: "rgba(255,255,255,0.55)",
  },
  2: {
    position: 2,
    name: "Azul",
    hex: "#2563EB",
    textOnBadge: "#FFFFFF",
    ring: "rgba(147,197,253,0.55)",
  },
  3: {
    position: 3,
    name: "Preto",
    hex: "#111827",
    textOnBadge: "#F9FAFB",
    ring: "rgba(255,255,255,0.45)",
  },
  4: {
    position: 4,
    name: "Vermelho",
    hex: "#DC2626",
    textOnBadge: "#FFFFFF",
    ring: "rgba(252,165,165,0.55)",
  },
};

export function isTeamJerseyPosition(value: number | null | undefined): value is TeamJerseyPosition {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function jerseyForPosition(position: number | null | undefined): TeamJersey | null {
  if (!isTeamJerseyPosition(position)) return null;
  return TEAM_JERSEYS[position];
}

/** Payload gravado no DrawTeam na geração do sorteio. */
export function drawTeamIdentity(position: number): { name: string; color: string } {
  const jersey = jerseyForPosition(position);
  if (!jersey) {
    return { name: `Time ${position}`, color: "#C9A227" };
  }
  return { name: jersey.name, color: jersey.hex };
}

export type TeamDisplayInput = {
  name: string;
  color: string | null;
  kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
  /** SessionTeam.initialQueuePosition ou DrawTeam.position. */
  position: number | null;
};

export type TeamDisplay = {
  /** Rótulo estável para UI (Branco/Azul/…). */
  displayName: string;
  /** Hex para badge; null se não houver camisa. */
  colorHex: string | null;
  jersey: TeamJersey | null;
};

/**
 * Resolve nome/cor de exibição sem alterar o banco.
 * REGULAR com posição 1–4 → camisa da posição (legado "Time N" incluso).
 * ROTATION_POOL → nome persistido (Rotativos).
 */
export function resolveTeamDisplay(input: TeamDisplayInput): TeamDisplay {
  if (input.kind === "ROTATION_POOL") {
    return {
      displayName: input.name || "Rotativos",
      colorHex: null,
      jersey: null,
    };
  }

  const jersey = jerseyForPosition(input.position);
  if (jersey) {
    // Posição é a identidade estável; hex canônico evita drift visual em legado.
    return {
      displayName: jersey.name,
      colorHex: jersey.hex,
      jersey,
    };
  }

  return {
    displayName: input.name,
    colorHex: input.color,
    jersey: null,
  };
}
