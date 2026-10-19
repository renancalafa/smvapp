import type { MatchEventType } from "@/domain/match/events";
import { civilDateInZone, zonedInstant, type CivilDate } from "@/domain/time/zoned";

export type MatchPlayerRole = "FIELD" | "GOALKEEPER";

/** Contadores individuais derivados de MatchEvent + MatchPlayer (fonte da verdade). */
export type PlayerStatTotals = {
  goals: number;
  assists: number;
  ownGoals: number;
  bigMisses: number;
  hitWoodwork: number;
  tackles: number;
  yellowCards: number;
  blueCards: number;
  redCards: number;
  /**
   * Partidas FINISHED em que o membro atuou como FIELD (não goleiro).
   * PJ = wins + draws + losses.
   */
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
};

export type StatMetric = keyof PlayerStatTotals;

export const EMPTY_TOTALS: PlayerStatTotals = {
  goals: 0,
  assists: 0,
  ownGoals: 0,
  bigMisses: 0,
  hitWoodwork: 0,
  tackles: 0,
  yellowCards: 0,
  blueCards: 0,
  redCards: 0,
  matchesPlayed: 0,
  wins: 0,
  draws: 0,
  losses: 0,
};

export const RANKING_METRICS = [
  "goals",
  "assists",
  "bigMisses",
  "hitWoodwork",
  "tackles",
  "yellowCards",
  "blueCards",
  "redCards",
  "ownGoals",
] as const satisfies readonly StatMetric[];

export type RankingMetric = (typeof RANKING_METRICS)[number];

export const RANKING_METRIC_LABELS: Record<RankingMetric, string> = {
  goals: "Artilharia",
  assists: "Assistências",
  bigMisses: "Pixotadas",
  hitWoodwork: "Bolas na trave",
  tackles: "Desarmes",
  yellowCards: "Cartões amarelos",
  blueCards: "Cartões azuis",
  redCards: "Cartões vermelhos",
  ownGoals: "Gols contra",
};

export type CountableEvent = {
  type: MatchEventType;
  memberId: string;
  assistMemberId: string | null;
  voidedAt: Date | string | null;
};

export type CountableAppearance = {
  memberId: string;
  matchId: string;
  teamId: string;
  role: MatchPlayerRole;
};

export type CountableMatchResult = {
  matchId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
};

export type IndividualMatchResult = "WIN" | "DRAW" | "LOSS";

/**
 * Resultado individual a partir do placar e do vencedor nos pênaltis persistido.
 * Não usa teamCount do Rei da Mesa: pênaltis → V/D; empate sem pênaltis → E.
 * Retorna null se os dados forem inconsistentes (time fora do confronto / pênaltis inválidos).
 */
export function individualResultForTeam(
  teamId: string,
  match: Pick<CountableMatchResult, "teamAId" | "teamBId" | "scoreA" | "scoreB" | "penaltyWinnerTeamId">,
): IndividualMatchResult | null {
  if (teamId !== match.teamAId && teamId !== match.teamBId) return null;

  if (match.scoreA > match.scoreB) return teamId === match.teamAId ? "WIN" : "LOSS";
  if (match.scoreB > match.scoreA) return teamId === match.teamBId ? "WIN" : "LOSS";

  if (match.penaltyWinnerTeamId) {
    if (match.penaltyWinnerTeamId !== match.teamAId && match.penaltyWinnerTeamId !== match.teamBId) {
      return null;
    }
    return teamId === match.penaltyWinnerTeamId ? "WIN" : "LOSS";
  }

  return "DRAW";
}

export function emptyTotals(): PlayerStatTotals {
  return { ...EMPTY_TOTALS };
}

/** (V / PJ) × 100; null quando não há partidas de linha. */
export function winPercentage(totals: Pick<PlayerStatTotals, "wins" | "matchesPlayed">): number | null {
  if (totals.matchesPlayed <= 0) return null;
  return (totals.wins / totals.matchesPlayed) * 100;
}

/** Eventos anulados não contam; OWN_GOAL ≠ GOAL; assistência só se assistMemberId. */
export function applyEvent(totals: PlayerStatTotals, event: CountableEvent): void {
  if (event.voidedAt) return;
  switch (event.type) {
    case "GOAL":
      totals.goals += 1;
      break;
    case "OWN_GOAL":
      totals.ownGoals += 1;
      break;
    case "BIG_MISS":
      totals.bigMisses += 1;
      break;
    case "HIT_WOODWORK":
      totals.hitWoodwork += 1;
      break;
    case "TACKLE":
      totals.tackles += 1;
      break;
    case "YELLOW_CARD":
      totals.yellowCards += 1;
      break;
    case "BLUE_CARD":
      totals.blueCards += 1;
      break;
    case "RED_CARD":
      totals.redCards += 1;
      break;
  }
}

export function applyAssist(totalsByMember: Map<string, PlayerStatTotals>, event: CountableEvent): void {
  if (event.voidedAt || event.type !== "GOAL" || !event.assistMemberId) return;
  const totals = totalsByMember.get(event.assistMemberId) ?? emptyTotals();
  totals.assists += 1;
  totalsByMember.set(event.assistMemberId, totals);
}

/**
 * Agrega eventos e aparições.
 * - Eventos: todos os roles (goleiro mantém gols/cartões etc.).
 * - PJ / V / E / D: só role FIELD em partidas com resultado classificável.
 */
export function aggregatePlayerStats(input: {
  events: readonly CountableEvent[];
  appearances: readonly CountableAppearance[];
  matchResults: readonly CountableMatchResult[];
  memberIds?: readonly string[];
}): Map<string, PlayerStatTotals> {
  const byMember = new Map<string, PlayerStatTotals>();
  const ensure = (memberId: string) => {
    let totals = byMember.get(memberId);
    if (!totals) {
      totals = emptyTotals();
      byMember.set(memberId, totals);
    }
    return totals;
  };

  for (const memberId of input.memberIds ?? []) ensure(memberId);

  const resultsByMatch = new Map(input.matchResults.map((match) => [match.matchId, match]));

  for (const appearance of input.appearances) {
    ensure(appearance.memberId);
    if (appearance.role !== "FIELD") continue;

    const match = resultsByMatch.get(appearance.matchId);
    if (!match) continue;
    const result = individualResultForTeam(appearance.teamId, match);
    if (!result) continue;

    const totals = ensure(appearance.memberId);
    totals.matchesPlayed += 1;
    if (result === "WIN") totals.wins += 1;
    else if (result === "DRAW") totals.draws += 1;
    else totals.losses += 1;
  }

  for (const event of input.events) {
    if (event.voidedAt) continue;
    applyEvent(ensure(event.memberId), event);
    applyAssist(byMember, event);
  }

  return byMember;
}

export type RankedEntry<T extends { memberId: string }> = T & {
  value: number;
  /** Posição de competição: empates compartilham o mesmo rank (1,2,2,4). */
  rank: number;
};

/** Ordena por valor desc; empate: nome asc estável via tieBreakLabel. */
export function buildRanking<T extends { memberId: string }>(
  rows: readonly T[],
  valueOf: (row: T) => number,
  tieBreakLabel: (row: T) => string,
  options: { includeZeros?: boolean } = {},
): RankedEntry<T>[] {
  const includeZeros = options.includeZeros ?? false;
  const sorted = [...rows]
    .filter((row) => includeZeros || valueOf(row) > 0)
    .sort((a, b) => {
      const diff = valueOf(b) - valueOf(a);
      if (diff !== 0) return diff;
      return tieBreakLabel(a).localeCompare(tieBreakLabel(b), "pt-BR", { sensitivity: "base" });
    });

  const ranked: RankedEntry<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    const value = valueOf(row);
    const prev = ranked[i - 1];
    const rank = prev && prev.value === value ? prev.rank : i + 1;
    ranked.push({ ...row, value, rank });
  }
  return ranked;
}

export type GeneralClassificationEntry<T extends { memberId: string }> = T & {
  winPercentage: number | null;
  /** null = sem partidas de linha (aparece abaixo; não implica empate com quem tem 0%). */
  rank: number | null;
};

/**
 * Classificação geral por aproveitamento (V/PJ)×100.
 * Sem mínimo de jogos. Sem partidas ficam abaixo; empates de % compartilham posição.
 */
export function buildGeneralClassification<T extends { memberId: string; totals: PlayerStatTotals }>(
  rows: readonly T[],
  tieBreakLabel: (row: T) => string,
): GeneralClassificationEntry<T>[] {
  const withPct = rows.map((row) => ({
    ...row,
    winPercentage: winPercentage(row.totals),
  }));

  const qualifying = withPct
    .filter((row) => row.totals.matchesPlayed > 0)
    .sort((a, b) => {
      const diff = (b.winPercentage ?? 0) - (a.winPercentage ?? 0);
      if (diff !== 0) return diff;
      return tieBreakLabel(a).localeCompare(tieBreakLabel(b), "pt-BR", { sensitivity: "base" });
    });

  const withoutMatches = withPct
    .filter((row) => row.totals.matchesPlayed === 0)
    .sort((a, b) => tieBreakLabel(a).localeCompare(tieBreakLabel(b), "pt-BR", { sensitivity: "base" }));

  const ranked: GeneralClassificationEntry<T>[] = [];
  for (let i = 0; i < qualifying.length; i++) {
    const row = qualifying[i]!;
    const prev = ranked[i - 1];
    const rank =
      prev && prev.winPercentage !== null && prev.winPercentage === row.winPercentage ? prev.rank : i + 1;
    ranked.push({ ...row, rank });
  }
  for (const row of withoutMatches) {
    ranked.push({ ...row, rank: null });
  }
  return ranked;
}

export type StatsPeriodFilter =
  | { kind: "all" }
  | { kind: "session"; sessionId: string }
  | { kind: "month"; year: number; month: number }
  | { kind: "year"; year: number };

/** Intervalo [start, end) no fuso do grupo para filtros mês/ano. */
export function periodInstantRange(
  filter: Extract<StatsPeriodFilter, { kind: "month" } | { kind: "year" }>,
  timeZone: string,
): { start: Date; end: Date } {
  if (filter.kind === "month") {
    const startDay: CivilDate = { year: filter.year, month: filter.month, day: 1 };
    const nextMonth =
      filter.month === 12
        ? { year: filter.year + 1, month: 1, day: 1 }
        : { year: filter.year, month: filter.month + 1, day: 1 };
    return { start: zonedInstant(startDay, 0, timeZone), end: zonedInstant(nextMonth, 0, timeZone) };
  }
  const startDay: CivilDate = { year: filter.year, month: 1, day: 1 };
  const endDay: CivilDate = { year: filter.year + 1, month: 1, day: 1 };
  return { start: zonedInstant(startDay, 0, timeZone), end: zonedInstant(endDay, 0, timeZone) };
}

/** Ano/mês civis da sessão no fuso do grupo (para listagens de filtro). */
export function sessionCivilMonth(startsAt: Date, timeZone: string): { year: number; month: number } {
  const { year, month } = civilDateInZone(startsAt, timeZone);
  return { year, month };
}

export function isRankingMetric(value: string): value is RankingMetric {
  return (RANKING_METRICS as readonly string[]).includes(value);
}

export function formatWinPercentage(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}
