import {
  buildRanking,
  formatWinPercentage,
  winPercentage,
  type PlayerStatTotals,
  type RankingMetric,
  type RankedEntry,
} from "@/domain/stats/aggregate";

export { formatWinPercentage };

/** Categorias do seletor horizontal na aba Geral. */
export const DASHBOARD_RANKING_CATEGORIES = [
  "goals",
  "assists",
  "presence",
  "winRate",
  "tackles",
  "bigMisses",
  "ownGoals",
  "hitWoodwork",
  "yellowCards",
  "blueCards",
  "redCards",
] as const;

export type DashboardRankingCategory = (typeof DASHBOARD_RANKING_CATEGORIES)[number];

export const DASHBOARD_RANKING_LABELS: Record<DashboardRankingCategory, string> = {
  goals: "Gols",
  assists: "Assistências",
  presence: "Presença",
  winRate: "Aproveitamento",
  tackles: "Desarmes",
  bigMisses: "Pixotadas",
  ownGoals: "Gols contra",
  hitWoodwork: "Traves",
  yellowCards: "Amarelos",
  blueCards: "Azuis",
  redCards: "Vermelhos",
};

export function isDashboardRankingCategory(value: string): value is DashboardRankingCategory {
  return (DASHBOARD_RANKING_CATEGORIES as readonly string[]).includes(value);
}

/** Conta só GOAL válidos (não OWN_GOAL, não anulados, não pênaltis). */
export function countValidGoals(
  events: readonly { type: string; voidedAt: Date | string | null }[],
): number {
  let total = 0;
  for (const event of events) {
    if (event.voidedAt) continue;
    if (event.type === "GOAL") total += 1;
  }
  return total;
}

export type DashboardOverview = {
  completedPeladas: number;
  totalGoals: number;
  /** totalGoals / completedPeladas — nunca usa PJ. */
  avgGoalsPerPelada: number | null;
  distinctPlayers: number;
  /** soma de participantes / completedPeladas. */
  avgParticipationPerSession: number | null;
};

export function buildDashboardOverview(input: {
  completedPeladas: number;
  totalGoals: number;
  distinctPlayers: number;
  totalParticipantSlots: number;
}): DashboardOverview {
  const completed = Math.max(0, input.completedPeladas);
  return {
    completedPeladas: completed,
    totalGoals: Math.max(0, input.totalGoals),
    avgGoalsPerPelada: completed > 0 ? input.totalGoals / completed : null,
    distinctPlayers: Math.max(0, input.distinctPlayers),
    avgParticipationPerSession: completed > 0 ? input.totalParticipantSlots / completed : null,
  };
}

export type GoalsSessionPoint = {
  sessionId: string;
  startsAt: string;
  goals: number;
  isLatest: boolean;
};

export type GoalsPerSessionSeries = {
  points: GoalsSessionPoint[];
  average: number | null;
};

/**
 * Últimas até 12 peladas FINISHED do período, em ordem cronológica.
 * `sessions` deve vir ordenado por startsAt desc (mais recente primeiro).
 */
export function buildGoalsPerSessionSeries(
  sessions: readonly { sessionId: string; startsAt: string; goals: number }[],
  limit = 12,
): GoalsPerSessionSeries {
  const newestFirst = sessions.slice(0, Math.max(0, limit));
  const chronological = [...newestFirst].reverse();
  const latestId = newestFirst[0]?.sessionId ?? null;
  const points = chronological.map((row) => ({
    ...row,
    isLatest: latestId != null && row.sessionId === latestId,
  }));
  const average =
    points.length > 0 ? points.reduce((sum, row) => sum + row.goals, 0) / points.length : null;
  return { points, average };
}

export type GoalsMatchPoint = {
  matchId: string;
  startedAt: string;
  sequence: number;
  goals: number;
  isLatest: boolean;
};

export type GoalsPerMatchTrend = "up" | "down" | "stable";

export type GoalsPerMatchSeries = {
  points: GoalsMatchPoint[];
  /** Média só das partidas exibidas (até `limit`). */
  displayedAverage: number | null;
  /** Média de todas as partidas elegíveis do período (participação via MatchPlayer). */
  periodAverage: number | null;
  periodMatchCount: number;
  /** Null quando não há janelas suficientes para comparar. */
  trend: GoalsPerMatchTrend | null;
};

/**
 * Série de gols por partida (não por pelada).
 * `matches` deve vir mais recente primeiro (startedAt desc, tie-break estável).
 * Inclui zeros; não muta o array de entrada.
 */
export function buildGoalsPerMatchSeries(
  matches: readonly { matchId: string; startedAt: string; sequence: number; goals: number }[],
  limit = 12,
  trendWindow = 3,
): GoalsPerMatchSeries {
  const periodMatchCount = matches.length;
  const periodGoals = matches.reduce((sum, row) => sum + row.goals, 0);
  const periodAverage = periodMatchCount > 0 ? periodGoals / periodMatchCount : null;

  const newestFirst = matches.slice(0, Math.max(0, limit));
  const chronological = [...newestFirst].reverse();
  const latestId = newestFirst[0]?.matchId ?? null;
  const points = chronological.map((row) => ({
    ...row,
    isLatest: latestId != null && row.matchId === latestId,
  }));
  const displayedAverage =
    points.length > 0 ? points.reduce((sum, row) => sum + row.goals, 0) / points.length : null;

  let trend: GoalsPerMatchTrend | null = null;
  if (points.length >= trendWindow * 2) {
    const recent = points.slice(-trendWindow);
    const prior = points.slice(-trendWindow * 2, -trendWindow);
    const recentAvg = recent.reduce((sum, row) => sum + row.goals, 0) / trendWindow;
    const priorAvg = prior.reduce((sum, row) => sum + row.goals, 0) / trendWindow;
    const delta = recentAvg - priorAvg;
    trend = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "stable";
  }

  return { points, displayedAverage, periodAverage, periodMatchCount, trend };
}

/** Ordenação estável mais-recente-primeiro para a série de partidas. */
export function compareMatchesNewestFirst(
  a: { startedAt: string; sequence: number; matchId: string },
  b: { startedAt: string; sequence: number; matchId: string },
): number {
  const byTime = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  if (byTime !== 0) return byTime;
  if (b.sequence !== a.sequence) return b.sequence - a.sequence;
  return b.matchId.localeCompare(a.matchId);
}

export type DashboardRankingEntry = {
  memberId: string;
  name: string;
  nickname: string | null;
  status: "ACTIVE" | "INACTIVE";
  value: number;
  rank: number;
  /** Ex.: "8 PJ" ou contexto de presença. */
  context: string | null;
};

type IdentityRow = {
  memberId: string;
  name: string;
  nickname: string | null;
  status: "ACTIVE" | "INACTIVE";
};

function labelOf(row: IdentityRow): string {
  return row.nickname ? `${row.name} (${row.nickname})` : row.name;
}

function toDashboardEntries(
  ranked: RankedEntry<IdentityRow & { context: string | null }>[],
): DashboardRankingEntry[] {
  return ranked.map((entry) => ({
    memberId: entry.memberId,
    name: entry.name,
    nickname: entry.nickname,
    status: entry.status,
    value: entry.value,
    rank: entry.rank,
    context: entry.context,
  }));
}

/** Ranking de presença (PARTICIPANT em sessões FINISHED). */
export function buildPresenceRanking(
  rows: readonly (IdentityRow & { presences: number })[],
  options: { includeZeros?: boolean } = {},
): DashboardRankingEntry[] {
  const ranked = buildRanking(
    rows.map((row) => ({ ...row, context: null as string | null })),
    (row) => row.presences,
    labelOf,
    options,
  );
  return toDashboardEntries(
    ranked.map((entry) => ({
      ...entry,
      context: entry.value === 1 ? "1 presença" : `${entry.value} presenças`,
    })),
  );
}

/** Ranking de aproveitamento (V/PJ)×100 — só quem tem PJ > 0. */
export function buildWinRateRanking(
  rows: readonly (IdentityRow & { totals: PlayerStatTotals })[],
): DashboardRankingEntry[] {
  const withPct = rows
    .map((row) => {
      const pct = winPercentage(row.totals);
      return pct === null
        ? null
        : {
            ...row,
            pct,
            context: `${row.totals.matchesPlayed} PJ`,
          };
    })
    .filter((row): row is IdentityRow & { totals: PlayerStatTotals; pct: number; context: string } => row != null);

  const ranked = buildRanking(withPct, (row) => row.pct, labelOf, { includeZeros: true });
  return toDashboardEntries(
    ranked.map((entry) => ({
      ...entry,
      // valor exibido como %; mantém número cru para barras proporcionais
      value: entry.value,
      context: entry.context,
    })),
  );
}

export function buildMetricRanking(
  rows: readonly (IdentityRow & { totals: PlayerStatTotals })[],
  metric: RankingMetric,
  options: { includeZeros?: boolean } = {},
): DashboardRankingEntry[] {
  const ranked = buildRanking(
    rows.map((row) => ({
      ...row,
      context: row.totals.matchesPlayed > 0 ? `${row.totals.matchesPlayed} PJ` : null,
    })),
    (row) => row.totals[metric],
    labelOf,
    options,
  );
  return toDashboardEntries(ranked);
}

export function formatDashboardRankingValue(
  category: DashboardRankingCategory,
  value: number,
): string {
  if (category === "winRate") return formatWinPercentage(value);
  return String(value);
}

export type PlayerEfficiency = {
  goalsPerMatch: number | null;
  assistsPerMatch: number | null;
  tacklesPerMatch: number | null;
  bigMissesPerMatch: number | null;
  ownGoalsPerMatch: number | null;
};

/** Médias por partida de linha (PJ). Null quando PJ = 0. */
export function buildPlayerEfficiency(totals: PlayerStatTotals): PlayerEfficiency {
  const pj = totals.matchesPlayed;
  if (pj <= 0) {
    return {
      goalsPerMatch: null,
      assistsPerMatch: null,
      tacklesPerMatch: null,
      bigMissesPerMatch: null,
      ownGoalsPerMatch: null,
    };
  }
  return {
    goalsPerMatch: totals.goals / pj,
    assistsPerMatch: totals.assists / pj,
    tacklesPerMatch: totals.tackles / pj,
    bigMissesPerMatch: totals.bigMisses / pj,
    ownGoalsPerMatch: totals.ownGoals / pj,
  };
}

export type StatsInsightKind =
  | "most_goals_session"
  | "most_assists_session"
  | "highest_attendance"
  | "most_consistent_scorer"
  | "recent_goals_trend";

export type StatsInsight = {
  kind: StatsInsightKind;
  title: string;
  valueLabel: string;
  detail: string;
  calculationNote: string;
};

export type SessionInsightInput = {
  sessionId: string;
  startsAt: string;
  label: string;
  goals: number;
  assists: number;
  attendance: number;
};

export type ConsistentScorerInput = IdentityRow & {
  sessionsWithGoal: number;
};

/**
 * Insights derivados só de dados persistidos.
 * Empates: lista os empatados no detalhe; valor é o recorde empatado.
 */
export function buildStatsInsights(input: {
  sessions: readonly SessionInsightInput[];
  consistentScorers: readonly ConsistentScorerInput[];
  recentWindow?: number;
}): StatsInsight[] {
  const insights: StatsInsight[] = [];
  const sessions = input.sessions;
  if (sessions.length === 0) return insights;

  const maxGoals = Math.max(...sessions.map((s) => s.goals));
  if (maxGoals > 0) {
    const winners = sessions.filter((s) => s.goals === maxGoals);
    insights.push({
      kind: "most_goals_session",
      title: "Mais gols em uma pelada",
      valueLabel: `${maxGoals} gols`,
      detail: winners.map((s) => s.label).join(" · "),
      calculationNote: "Soma de eventos GOAL válidos na sessão (exclui gols contra e pênaltis).",
    });
  }

  const maxAssists = Math.max(...sessions.map((s) => s.assists));
  if (maxAssists > 0) {
    const winners = sessions.filter((s) => s.assists === maxAssists);
    insights.push({
      kind: "most_assists_session",
      title: "Mais assistências em uma pelada",
      valueLabel: `${maxAssists} assistências`,
      detail: winners.map((s) => s.label).join(" · "),
      calculationNote: "Conta assistMemberId em eventos GOAL válidos da sessão.",
    });
  }

  const maxAttendance = Math.max(...sessions.map((s) => s.attendance));
  if (maxAttendance > 0) {
    const winners = sessions.filter((s) => s.attendance === maxAttendance);
    insights.push({
      kind: "highest_attendance",
      title: "Maior presença",
      valueLabel: `${maxAttendance} confirmados`,
      detail: winners.map((s) => s.label).join(" · "),
      calculationNote: "Inscrições PARTICIPANT na sessão FINISHED.",
    });
  }

  const scorers = [...input.consistentScorers]
    .filter((row) => row.sessionsWithGoal > 0)
    .sort((a, b) => {
      const diff = b.sessionsWithGoal - a.sessionsWithGoal;
      if (diff !== 0) return diff;
      return labelOf(a).localeCompare(labelOf(b), "pt-BR", { sensitivity: "base" });
    });
  if (scorers.length > 0) {
    const top = scorers[0]!;
    const tied = scorers.filter((row) => row.sessionsWithGoal === top.sessionsWithGoal);
    insights.push({
      kind: "most_consistent_scorer",
      title: "Artilheiro mais constante",
      valueLabel: `${top.sessionsWithGoal} peladas`,
      detail: tied.map(labelOf).join(" · "),
      calculationNote:
        "Número de peladas FINISHED distintas em que o jogador marcou ≥1 GOAL válido no período.",
    });
  }

  const window = input.recentWindow ?? 5;
  if (sessions.length >= window * 2) {
    const newestFirst = [...sessions].sort(
      (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    );
    const recent = newestFirst.slice(0, window);
    const prior = newestFirst.slice(window, window * 2);
    const recentAvg = recent.reduce((sum, s) => sum + s.goals, 0) / window;
    const priorAvg = prior.reduce((sum, s) => sum + s.goals, 0) / prior.length;
    const delta = recentAvg - priorAvg;
    const direction = delta > 0.05 ? "alta" : delta < -0.05 ? "queda" : "estável";
    insights.push({
      kind: "recent_goals_trend",
      title: "Tendência recente de gols",
      valueLabel: direction === "alta" ? "Em alta" : direction === "queda" ? "Em queda" : "Estável",
      detail: `Média das ${window} últimas: ${recentAvg.toFixed(1)} · ${window} anteriores: ${priorAvg.toFixed(1)}`,
      calculationNote: `Compara a média de GOAL válidos nas ${window} peladas FINISHED mais recentes com as ${window} anteriores no mesmo período.`,
    });
  }

  return insights;
}

export function formatAvg(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}
