import "server-only";
import { scoreFromEvents } from "@/domain/match/queue";
import {
  aggregatePlayerStats,
  buildGeneralClassification,
  buildRanking,
  emptyTotals,
  individualResultForTeam,
  periodInstantRange,
  sessionCivilMonth,
  winPercentage,
  type GeneralClassificationEntry,
  type PlayerStatTotals,
  type RankingMetric,
  type RankedEntry,
  type StatsPeriodFilter,
} from "@/domain/stats/aggregate";
import {
  buildDashboardOverview,
  buildGoalsPerSessionSeries,
  buildMetricRanking,
  buildPlayerEfficiency,
  buildPresenceRanking,
  buildStatsInsights,
  buildWinRateRanking,
  countValidGoals,
  type DashboardOverview,
  type DashboardRankingCategory,
  type DashboardRankingEntry,
  type GoalsPerSessionSeries,
  type PlayerEfficiency,
  type StatsInsight,
} from "@/domain/stats/dashboard";
import { civilDateInZone } from "@/domain/time/zoned";
import { db } from "@/server/db";

export type { PlayerStatTotals, RankingMetric, StatsPeriodFilter };
export type {
  DashboardOverview,
  DashboardRankingCategory,
  DashboardRankingEntry,
  GoalsPerSessionSeries,
  PlayerEfficiency,
  StatsInsight,
};
export {
  RANKING_METRIC_LABELS,
  RANKING_METRICS,
  formatWinPercentage,
  isRankingMetric,
  winPercentage,
} from "@/domain/stats/aggregate";
export {
  DASHBOARD_RANKING_CATEGORIES,
  DASHBOARD_RANKING_LABELS,
  formatAvg,
  formatDashboardRankingValue,
  isDashboardRankingCategory,
} from "@/domain/stats/dashboard";

export type StatsPlayerIdentity = {
  memberId: string;
  name: string;
  nickname: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export type PlayerStatsRow = StatsPlayerIdentity & { totals: PlayerStatTotals };

export type RankingBoard = {
  metric: RankingMetric;
  entries: RankedEntry<StatsPlayerIdentity>[];
};

export type GeneralClassificationBoard = {
  entries: GeneralClassificationEntry<StatsPlayerIdentity & { totals: PlayerStatTotals }>[];
};

export type StatsFilterOptions = {
  sessions: { id: string; startsAt: string; labelStartsAt: Date }[];
  months: { year: number; month: number }[];
  years: number[];
};

export type RecentMatchStat = {
  matchId: string;
  sessionId: string;
  sequence: number;
  startedAt: string;
  teamName: string;
  opponentName: string;
  scoreFor: number;
  scoreAgainst: number;
  role: "FIELD" | "GOALKEEPER";
  result: "WIN" | "DRAW" | "LOSS" | null;
  goals: number;
  assists: number;
  ownGoals: number;
  bigMisses: number;
  cards: number;
};

function displayLabel(player: StatsPlayerIdentity): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

function parsePeriod(raw: {
  scope?: string | null;
  sessionId?: string | null;
  year?: string | null;
  month?: string | null;
}): StatsPeriodFilter {
  const scope = raw.scope ?? "all";
  if (scope === "session" && raw.sessionId) return { kind: "session", sessionId: raw.sessionId };
  if (scope === "month" && raw.year && raw.month) {
    const year = Number(raw.year);
    const month = Number(raw.month);
    if (Number.isInteger(year) && month >= 1 && month <= 12) return { kind: "month", year, month };
  }
  if (scope === "year" && raw.year) {
    const year = Number(raw.year);
    if (Number.isInteger(year)) return { kind: "year", year };
  }
  return { kind: "all" };
}

export function parseStatsPeriodFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): StatsPeriodFilter {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return parsePeriod({
    scope: one("scope"),
    sessionId: one("sessionId"),
    year: one("year"),
    month: one("month"),
  });
}

function periodSessionConstraints(period: StatsPeriodFilter, timeZone: string) {
  return {
    ...(period.kind === "session" ? { id: period.sessionId } : {}),
    ...(period.kind === "month" || period.kind === "year"
      ? (() => {
          const { start, end } = periodInstantRange(period, timeZone);
          return { startsAt: { gte: start, lt: end } };
        })()
      : {}),
  };
}

async function finishedMatchWhere(groupId: string, period: StatsPeriodFilter, timeZone: string) {
  return {
    status: "FINISHED" as const,
    gameSession: {
      groupId,
      status: { not: "CANCELLED" as const },
      ...periodSessionConstraints(period, timeZone),
    },
  };
}

function finishedSessionWhere(groupId: string, period: StatsPeriodFilter, timeZone: string) {
  return {
    groupId,
    status: "FINISHED" as const,
    ...periodSessionConstraints(period, timeZone),
  };
}

function sessionDayLabel(startsAt: Date, timeZone: string): string {
  const { day, month } = civilDateInZone(startsAt, timeZone);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

async function loadMembers(groupId: string, memberIds: string[]): Promise<Map<string, StatsPlayerIdentity>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db.groupMember.findMany({
    where: { groupId, id: { in: memberIds } },
    select: {
      id: true,
      status: true,
      nickname: true,
      user: { select: { name: true } },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        memberId: row.id,
        name: row.user.name,
        nickname: row.nickname,
        status: row.status,
      },
    ]),
  );
}

async function loadFinishedMatchesPayload(groupId: string, timeZone: string, period: StatsPeriodFilter) {
  const matchWhere = await finishedMatchWhere(groupId, period, timeZone);
  return db.match.findMany({
    where: matchWhere,
    select: {
      id: true,
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      events: {
        select: {
          type: true,
          memberId: true,
          assistMemberId: true,
          teamId: true,
          voidedAt: true,
        },
      },
      players: {
        select: { memberId: true, matchId: true, teamId: true, role: true },
      },
    },
  });
}

function aggregateFromMatches(
  matches: Awaited<ReturnType<typeof loadFinishedMatchesPayload>>,
  memberIdsHint?: string[],
) {
  const events = matches.flatMap((match) =>
    match.events.map((event) => ({
      type: event.type,
      memberId: event.memberId,
      assistMemberId: event.assistMemberId,
      voidedAt: event.voidedAt,
    })),
  );
  const appearances = matches.flatMap((match) => match.players);
  const matchResults = matches.map((match) => {
    const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
    return {
      matchId: match.id,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA,
      scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    };
  });

  const memberIds = new Set<string>(memberIdsHint ?? []);
  for (const row of appearances) memberIds.add(row.memberId);
  for (const event of events) {
    memberIds.add(event.memberId);
    if (event.assistMemberId) memberIds.add(event.assistMemberId);
  }

  return {
    aggregated: aggregatePlayerStats({
      events,
      appearances,
      matchResults,
      memberIds: [...memberIds],
    }),
    memberIds,
    matches,
  };
}

async function buildPlayerStatsTableFromMatches(
  groupId: string,
  matches: Awaited<ReturnType<typeof loadFinishedMatchesPayload>>,
  memberIdsHint?: string[],
): Promise<PlayerStatsRow[]> {
  const { aggregated, memberIds } = aggregateFromMatches(matches, memberIdsHint);
  const identities = await loadMembers(groupId, [...memberIds]);

  const rows: PlayerStatsRow[] = [];
  for (const memberId of memberIds) {
    const identity = identities.get(memberId);
    if (!identity) continue;
    rows.push({
      ...identity,
      totals: aggregated.get(memberId) ?? emptyTotals(),
    });
  }
  rows.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b), "pt-BR", { sensitivity: "base" }));
  return rows;
}

/** Totais por jogador no período (inclui inativos; zeros para quem só apareceu). */
export async function getPlayerStatsTable(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<PlayerStatsRow[]> {
  const matches = await loadFinishedMatchesPayload(groupId, timeZone, period);
  return buildPlayerStatsTableFromMatches(groupId, matches);
}

function boardsFromTable(table: PlayerStatsRow[], period: StatsPeriodFilter): RankingBoard[] {
  const includeZeros = period.kind === "session";
  const metrics: RankingMetric[] = [
    "goals",
    "assists",
    "bigMisses",
    "hitWoodwork",
    "tackles",
    "yellowCards",
    "blueCards",
    "redCards",
    "ownGoals",
  ];
  return metrics.map((metric) => ({
    metric,
    entries: buildRanking(table, (row) => row.totals[metric], displayLabel, { includeZeros }).map((entry) => ({
      memberId: entry.memberId,
      name: entry.name,
      nickname: entry.nickname,
      status: entry.status,
      value: entry.value,
      rank: entry.rank,
    })),
  }));
}

export async function getRankingBoard(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
  metric: RankingMetric,
  options: { includeZeros?: boolean } = {},
): Promise<RankingBoard> {
  const table = await getPlayerStatsTable(groupId, timeZone, period);
  const includeZeros = options.includeZeros ?? period.kind === "session";
  const entries = buildRanking(table, (row) => row.totals[metric], displayLabel, { includeZeros }).map(
    (entry) => ({
      memberId: entry.memberId,
      name: entry.name,
      nickname: entry.nickname,
      status: entry.status,
      value: entry.value,
      rank: entry.rank,
    }),
  );
  return { metric, entries };
}

export async function getAllRankingBoards(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<RankingBoard[]> {
  const table = await getPlayerStatsTable(groupId, timeZone, period);
  return boardsFromTable(table, period);
}

export async function getGeneralClassification(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<GeneralClassificationBoard> {
  const table = await getPlayerStatsTable(groupId, timeZone, period);
  return {
    entries: buildGeneralClassification(table, displayLabel),
  };
}

export type StatsDashboard = {
  overview: DashboardOverview;
  goalsSeries: GoalsPerSessionSeries;
  rankings: Record<DashboardRankingCategory, DashboardRankingEntry[]>;
};

export type StatsPlayerListItem = StatsPlayerIdentity & {
  modality: "MONTHLY" | "DAILY";
  role: "ADMIN" | "PLAYER";
};

/** Painel Geral: overview + série de gols + rankings (um único load de partidas). */
export async function getStatsDashboard(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<StatsDashboard> {
  const [matches, finishedSessions] = await Promise.all([
    loadFinishedMatchesPayload(groupId, timeZone, period),
    db.gameSession.findMany({
      where: finishedSessionWhere(groupId, period, timeZone),
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        startsAt: true,
        registrations: {
          where: { status: "PARTICIPANT" },
          select: { memberId: true },
        },
        matches: {
          where: { status: "FINISHED" },
          select: {
            events: {
              select: { type: true, assistMemberId: true, voidedAt: true },
            },
          },
        },
      },
    }),
  ]);

  const table = await buildPlayerStatsTableFromMatches(groupId, matches);
  const includeZeros = period.kind === "session";

  const sessionGoalRows = finishedSessions.map((session) => {
    const events = session.matches.flatMap((match) => match.events);
    return {
      sessionId: session.id,
      startsAt: session.startsAt.toISOString(),
      goals: countValidGoals(events),
      assists: events.filter((event) => !event.voidedAt && event.type === "GOAL" && event.assistMemberId)
        .length,
      attendance: session.registrations.length,
      participants: session.registrations.map((row) => row.memberId),
    };
  });

  const totalGoals = sessionGoalRows.reduce((sum, row) => sum + row.goals, 0);
  const totalParticipantSlots = sessionGoalRows.reduce((sum, row) => sum + row.attendance, 0);
  const distinctPlayers = new Set(sessionGoalRows.flatMap((row) => row.participants)).size;

  const presenceCounts = new Map<string, number>();
  for (const row of sessionGoalRows) {
    for (const memberId of row.participants) {
      presenceCounts.set(memberId, (presenceCounts.get(memberId) ?? 0) + 1);
    }
  }
  const presenceIdentities = await loadMembers(groupId, [...presenceCounts.keys()]);
  const presenceRows = [...presenceCounts.entries()]
    .map(([memberId, presences]) => {
      const identity = presenceIdentities.get(memberId);
      if (!identity) return null;
      return { ...identity, presences };
    })
    .filter((row): row is StatsPlayerIdentity & { presences: number } => row != null);

  const rankings: StatsDashboard["rankings"] = {
    goals: buildMetricRanking(table, "goals", { includeZeros }),
    assists: buildMetricRanking(table, "assists", { includeZeros }),
    presence: buildPresenceRanking(presenceRows, { includeZeros }),
    winRate: buildWinRateRanking(table),
    tackles: buildMetricRanking(table, "tackles", { includeZeros }),
    bigMisses: buildMetricRanking(table, "bigMisses", { includeZeros }),
    ownGoals: buildMetricRanking(table, "ownGoals", { includeZeros }),
    hitWoodwork: buildMetricRanking(table, "hitWoodwork", { includeZeros }),
    yellowCards: buildMetricRanking(table, "yellowCards", { includeZeros }),
    blueCards: buildMetricRanking(table, "blueCards", { includeZeros }),
    redCards: buildMetricRanking(table, "redCards", { includeZeros }),
  };

  return {
    overview: buildDashboardOverview({
      completedPeladas: finishedSessions.length,
      totalGoals,
      distinctPlayers,
      totalParticipantSlots,
    }),
    goalsSeries: buildGoalsPerSessionSeries(
      sessionGoalRows.map((row) => ({
        sessionId: row.sessionId,
        startsAt: row.startsAt,
        goals: row.goals,
      })),
    ),
    rankings,
  };
}

export async function getStatsInsights(
  groupId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<StatsInsight[]> {
  const finishedSessions = await db.gameSession.findMany({
    where: finishedSessionWhere(groupId, period, timeZone),
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      startsAt: true,
      registrations: {
        where: { status: "PARTICIPANT" },
        select: { memberId: true },
      },
      matches: {
        where: { status: "FINISHED" },
        select: {
          events: {
            select: { type: true, memberId: true, assistMemberId: true, voidedAt: true },
          },
        },
      },
    },
  });

  const sessions = finishedSessions.map((session) => {
    const events = session.matches.flatMap((match) => match.events);
    return {
      sessionId: session.id,
      startsAt: session.startsAt.toISOString(),
      label: sessionDayLabel(session.startsAt, timeZone),
      goals: countValidGoals(events),
      assists: events.filter((event) => !event.voidedAt && event.type === "GOAL" && event.assistMemberId)
        .length,
      attendance: session.registrations.length,
    };
  });

  const sessionsWithGoalByMember = new Map<string, Set<string>>();
  for (const session of finishedSessions) {
    const scorers = new Set<string>();
    for (const match of session.matches) {
      for (const event of match.events) {
        if (event.voidedAt || event.type !== "GOAL") continue;
        scorers.add(event.memberId);
      }
    }
    for (const memberId of scorers) {
      const set = sessionsWithGoalByMember.get(memberId) ?? new Set();
      set.add(session.id);
      sessionsWithGoalByMember.set(memberId, set);
    }
  }

  const identities = await loadMembers(groupId, [...sessionsWithGoalByMember.keys()]);
  const consistentScorers = [...sessionsWithGoalByMember.entries()]
    .map(([memberId, set]) => {
      const identity = identities.get(memberId);
      if (!identity) return null;
      return { ...identity, sessionsWithGoal: set.size };
    })
    .filter((row): row is StatsPlayerIdentity & { sessionsWithGoal: number } => row != null);

  return buildStatsInsights({ sessions, consistentScorers });
}

export async function listStatsPlayers(groupId: string): Promise<StatsPlayerListItem[]> {
  const rows = await db.groupMember.findMany({
    where: { groupId },
    orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
    select: {
      id: true,
      status: true,
      nickname: true,
      modality: true,
      role: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    memberId: row.id,
    name: row.user.name,
    nickname: row.nickname,
    status: row.status,
    modality: row.modality,
    role: row.role,
  }));
}

export async function getPlayerDashboardStats(
  groupId: string,
  memberId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<{
  player: StatsPlayerIdentity & { modality: "MONTHLY" | "DAILY"; role: "ADMIN" | "PLAYER" };
  totals: PlayerStatTotals;
  winPercentage: number | null;
  presences: number;
  efficiency: PlayerEfficiency;
  recentMatches: RecentMatchStat[];
} | null> {
  const member = await db.groupMember.findFirst({
    where: { id: memberId, groupId },
    select: {
      id: true,
      status: true,
      nickname: true,
      modality: true,
      role: true,
      user: { select: { name: true } },
    },
  });
  if (!member) return null;

  const [profile, presences] = await Promise.all([
    getPlayerProfileStats(groupId, memberId, timeZone, period),
    db.sessionRegistration.count({
      where: {
        memberId,
        status: "PARTICIPANT",
        gameSession: finishedSessionWhere(groupId, period, timeZone),
      },
    }),
  ]);
  if (!profile) return null;

  return {
    player: {
      ...profile.player,
      modality: member.modality,
      role: member.role,
    },
    totals: profile.totals,
    winPercentage: profile.winPercentage,
    presences,
    efficiency: buildPlayerEfficiency(profile.totals),
    recentMatches: profile.recentMatches,
  };
}

export async function getPlayerProfileStats(
  groupId: string,
  memberId: string,
  timeZone: string,
  period: StatsPeriodFilter,
): Promise<{
  player: StatsPlayerIdentity;
  totals: PlayerStatTotals;
  winPercentage: number | null;
  recentMatches: RecentMatchStat[];
} | null> {
  const member = await db.groupMember.findFirst({
    where: { id: memberId, groupId },
    select: {
      id: true,
      status: true,
      nickname: true,
      user: { select: { name: true } },
    },
  });
  if (!member) return null;

  const player: StatsPlayerIdentity = {
    memberId: member.id,
    name: member.user.name,
    nickname: member.nickname,
    status: member.status,
  };

  const matchWhere = await finishedMatchWhere(groupId, period, timeZone);
  const matches = await db.match.findMany({
    where: matchWhere,
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      sequence: true,
      startedAt: true,
      gameSessionId: true,
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      teamA: { select: { name: true } },
      teamB: { select: { name: true } },
      events: {
        select: {
          type: true,
          memberId: true,
          assistMemberId: true,
          teamId: true,
          voidedAt: true,
        },
      },
      players: {
        select: { memberId: true, matchId: true, teamId: true, role: true },
      },
    },
  });

  const { aggregated } = aggregateFromMatches(matches, [memberId]);
  const totals = aggregated.get(memberId) ?? emptyTotals();

  const recentMatches: RecentMatchStat[] = [];
  for (const match of matches) {
    const appearance = match.players.find((row) => row.memberId === memberId);
    if (!appearance) continue;
    const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
    const myTeamId = appearance.teamId;
    const isA = myTeamId === match.teamAId;
    const scoreFor = isA ? scoreA : scoreB;
    const scoreAgainst = isA ? scoreB : scoreA;
    const result =
      appearance.role === "FIELD"
        ? individualResultForTeam(myTeamId, {
            teamAId: match.teamAId,
            teamBId: match.teamBId,
            scoreA,
            scoreB,
            penaltyWinnerTeamId: match.penaltyWinnerTeamId,
          })
        : null;

    let goals = 0;
    let assists = 0;
    let ownGoals = 0;
    let bigMisses = 0;
    let cards = 0;
    for (const event of match.events) {
      if (event.voidedAt) continue;
      if (event.type === "GOAL") {
        if (event.memberId === memberId) goals += 1;
        if (event.assistMemberId === memberId) assists += 1;
      } else if (event.type === "OWN_GOAL" && event.memberId === memberId) {
        ownGoals += 1;
      } else if (event.memberId === memberId) {
        if (event.type === "BIG_MISS") bigMisses += 1;
        if (event.type === "YELLOW_CARD" || event.type === "BLUE_CARD" || event.type === "RED_CARD") cards += 1;
      }
    }

    recentMatches.push({
      matchId: match.id,
      sessionId: match.gameSessionId,
      sequence: match.sequence,
      startedAt: match.startedAt.toISOString(),
      teamName: isA ? match.teamA.name : match.teamB.name,
      opponentName: isA ? match.teamB.name : match.teamA.name,
      scoreFor,
      scoreAgainst,
      role: appearance.role,
      result,
      goals,
      assists,
      ownGoals,
      bigMisses,
      cards,
    });
    if (recentMatches.length >= 20) break;
  }

  return { player, totals, winPercentage: winPercentage(totals), recentMatches };
}

/** Opções de filtro a partir de sessões com partida finalizada. */
export async function getStatsFilterOptions(groupId: string, timeZone: string): Promise<StatsFilterOptions> {
  const sessions = await db.gameSession.findMany({
    where: {
      groupId,
      status: { not: "CANCELLED" },
      matches: { some: { status: "FINISHED" } },
    },
    orderBy: { startsAt: "desc" },
    take: 40,
    select: { id: true, startsAt: true },
  });

  const monthKeys = new Map<string, { year: number; month: number }>();
  const years = new Set<number>();
  for (const session of sessions) {
    const { year, month } = sessionCivilMonth(session.startsAt, timeZone);
    monthKeys.set(`${year}-${month}`, { year, month });
    years.add(year);
  }

  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      startsAt: session.startsAt.toISOString(),
      labelStartsAt: session.startsAt,
    })),
    months: [...monthKeys.values()].sort((a, b) => b.year - a.year || b.month - a.month),
    years: [...years].sort((a, b) => b - a),
  };
}

export function periodToSearchParams(period: StatsPeriodFilter): Record<string, string> {
  if (period.kind === "all") return { scope: "all" };
  if (period.kind === "session") return { scope: "session", sessionId: period.sessionId };
  if (period.kind === "month") {
    return { scope: "month", year: String(period.year), month: String(period.month) };
  }
  return { scope: "year", year: String(period.year) };
}
