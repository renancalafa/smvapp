// Agregados puros da Rodada a partir de partidas FINISHED e eventos. Sem inventar dados.
import {
  aggregatePlayerStats,
  emptyTotals,
  individualResultForTeam,
  type CountableEvent,
  type PlayerStatTotals,
} from "@/domain/stats/aggregate";

export type RodadaTeamInput = {
  id: string;
  name: string;
  color: string | null;
  kind: "REGULAR" | "BIRTHDAY" | "ROTATION_POOL";
  initialQueuePosition: number | null;
};

export type RodadaFinishedMatchInput = {
  id: string;
  sequence: number;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
};

export type RodadaTeamStanding = {
  teamId: string;
  name: string;
  color: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Colocação 1-based; times empatados após todos os critérios compartilham o mesmo rank. */
  rank: number;
  /** true se outro time compartilha o mesmo rank (empate total nos critérios). */
  rankTied: boolean;
};

export type RodadaHeadToHeadCell = {
  rowTeamId: string;
  colTeamId: string;
  /** null = sem confronto FINISHED entre o par (ou célula diagonal). */
  score: { for: number; against: number; penaltyWin: boolean } | null;
};

/** Critério que separou o campeão após filtrar o empate anterior. */
export type RodadaChampionDecidedBy =
  | "wins"
  | "goalDifference"
  | "goalsFor"
  | "headToHead";

export type RodadaChampion =
  | {
      kind: "determined";
      teamId: string;
      teamName: string;
      wins: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
      decidedBy: RodadaChampionDecidedBy;
      /** Ex.: "Campeão pelo saldo de gols". */
      reason: string;
    }
  | {
      kind: "tied";
      teamIds: string[];
      teamNames: string[];
      wins: number;
      reason: "Empate na liderança";
    }
  | { kind: "undetermined"; reason: string };

const CHAMPION_REASON: Record<RodadaChampionDecidedBy, string> = {
  wins: "Campeão pelas vitórias",
  goalDifference: "Campeão pelo saldo de gols",
  goalsFor: "Campeão pelos gols marcados",
  headToHead: "Campeão pelo confronto direto",
};

export type RodadaPlayerStatRow = {
  memberId: string;
  name: string;
  nickname: string | null;
  totals: PlayerStatTotals;
};

function filterBestBy(
  group: RodadaTeamStanding[],
  metric: (row: RodadaTeamStanding) => number,
): RodadaTeamStanding[] {
  let best = Number.NEGATIVE_INFINITY;
  for (const row of group) {
    const value = metric(row);
    if (value > best) best = value;
  }
  return group.filter((row) => metric(row) === best);
}

/**
 * Ordena e ranqueia com os mesmos critérios do campeão:
 * vitórias → SG → GP → vitórias H2H entre os ainda empatados.
 * Empate total → mesmo `rank` (não inventa ordem definitiva).
 */
function assignStandingsRanks(
  rows: RodadaTeamStanding[],
  matches: ReadonlyArray<RodadaFinishedMatchInput>,
): RodadaTeamStanding[] {
  const remaining = [...rows];
  const ordered: RodadaTeamStanding[] = [];

  while (remaining.length > 0) {
    let leaders = filterBestBy(remaining, (row) => row.wins);
    if (leaders.length > 1) leaders = filterBestBy(leaders, (row) => row.goalDifference);
    if (leaders.length > 1) leaders = filterBestBy(leaders, (row) => row.goalsFor);
    if (leaders.length > 1) {
      const h2h = countHeadToHeadWinsAmong(
        leaders.map((row) => row.teamId),
        matches,
      );
      leaders = filterBestBy(leaders, (row) => h2h.get(row.teamId) ?? 0);
    }

    leaders.sort((a, b) => a.teamId.localeCompare(b.teamId));
    const rank = ordered.length + 1;
    const tied = leaders.length > 1;
    for (const row of leaders) {
      row.rank = rank;
      row.rankTied = tied;
      ordered.push(row);
    }

    const taken = new Set(leaders.map((row) => row.teamId));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (taken.has(remaining[i]!.teamId)) remaining.splice(i, 1);
    }
  }

  return ordered;
}

/** Placar agregado e W/D/L por time a partir só de partidas FINISHED. */
export function buildTeamStandings(
  teams: ReadonlyArray<RodadaTeamInput>,
  matches: ReadonlyArray<RodadaFinishedMatchInput>,
): RodadaTeamStanding[] {
  const byId = new Map<string, RodadaTeamStanding>();
  for (const team of teams) {
    byId.set(team.id, {
      teamId: team.id,
      name: team.name,
      color: team.color,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      rank: 0,
      rankTied: false,
    });
  }

  for (const match of matches) {
    const sideA = byId.get(match.teamAId);
    const sideB = byId.get(match.teamBId);
    if (!sideA || !sideB) continue;

    sideA.played += 1;
    sideB.played += 1;
    sideA.goalsFor += match.scoreA;
    sideA.goalsAgainst += match.scoreB;
    sideB.goalsFor += match.scoreB;
    sideB.goalsAgainst += match.scoreA;

    const resultA = individualResultForTeam(match.teamAId, match);
    const resultB = individualResultForTeam(match.teamBId, match);
    if (resultA === "WIN") {
      sideA.wins += 1;
      sideA.points += 3;
    } else if (resultA === "DRAW") {
      sideA.draws += 1;
      sideA.points += 1;
    } else if (resultA === "LOSS") {
      sideA.losses += 1;
    }
    if (resultB === "WIN") {
      sideB.wins += 1;
      sideB.points += 3;
    } else if (resultB === "DRAW") {
      sideB.draws += 1;
      sideB.points += 1;
    } else if (resultB === "LOSS") {
      sideB.losses += 1;
    }
  }

  for (const row of byId.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return assignStandingsRanks([...byId.values()], matches);
}

/**
 * Matriz NxN: célula [i][j] = último confronto FINISHED de i×j (por sequence),
 * placar do ponto de vista da linha. Diagonal e pares sem jogo → null.
 */
export function buildHeadToHeadMatrix(
  teams: ReadonlyArray<RodadaTeamInput>,
  matches: ReadonlyArray<RodadaFinishedMatchInput>,
): { teamIds: string[]; cells: RodadaHeadToHeadCell[] } {
  const teamIds = teams.map((team) => team.id);
  const latest = new Map<string, RodadaFinishedMatchInput>();
  for (const match of [...matches].sort((a, b) => a.sequence - b.sequence)) {
    const key = [match.teamAId, match.teamBId].sort().join(":");
    latest.set(key, match);
  }

  const cells: RodadaHeadToHeadCell[] = [];
  for (const rowId of teamIds) {
    for (const colId of teamIds) {
      if (rowId === colId) {
        cells.push({ rowTeamId: rowId, colTeamId: colId, score: null });
        continue;
      }
      const key = [rowId, colId].sort().join(":");
      const match = latest.get(key);
      if (!match) {
        cells.push({ rowTeamId: rowId, colTeamId: colId, score: null });
        continue;
      }
      const rowIsA = match.teamAId === rowId;
      cells.push({
        rowTeamId: rowId,
        colTeamId: colId,
        score: {
          for: rowIsA ? match.scoreA : match.scoreB,
          against: rowIsA ? match.scoreB : match.scoreA,
          penaltyWin: match.penaltyWinnerTeamId === rowId,
        },
      });
    }
  }
  return { teamIds, cells };
}

/**
 * Vitórias em partidas FINISHED. WIN e PENALTY_WIN contam 1; empates não.
 * Placar de pênaltis não entra em gols — só penaltyWinnerTeamId define o resultado.
 */
export function countTeamWins(
  teams: ReadonlyArray<Pick<RodadaTeamInput, "id">>,
  finished: ReadonlyArray<RodadaFinishedMatchInput>,
): Map<string, number> {
  const wins = new Map<string, number>();
  for (const team of teams) wins.set(team.id, 0);
  for (const match of finished) {
    for (const teamId of [match.teamAId, match.teamBId]) {
      if (!wins.has(teamId)) wins.set(teamId, 0);
      if (individualResultForTeam(teamId, match) === "WIN") {
        wins.set(teamId, (wins.get(teamId) ?? 0) + 1);
      }
    }
  }
  return wins;
}

/**
 * Vitórias no confronto direto entre um conjunto de times ainda empatados:
 * agrega TODOS os FINISHED em que ambos os lados estão no conjunto (não só o último).
 */
export function countHeadToHeadWinsAmong(
  candidateIds: ReadonlyArray<string>,
  finished: ReadonlyArray<RodadaFinishedMatchInput>,
): Map<string, number> {
  const candidates = new Set(candidateIds);
  const wins = new Map<string, number>();
  for (const id of candidateIds) wins.set(id, 0);

  for (const match of finished) {
    if (!candidates.has(match.teamAId) || !candidates.has(match.teamBId)) continue;
    for (const teamId of [match.teamAId, match.teamBId]) {
      const result = individualResultForTeam(teamId, match);
      if (result === "WIN") {
        wins.set(teamId, (wins.get(teamId) ?? 0) + 1);
      }
      // result null (dados incompletos) ou DRAW: não conta vitória.
    }
  }
  return wins;
}

function filterLeadersByMetric(
  candidateIds: ReadonlyArray<string>,
  metric: (teamId: string) => number,
): string[] {
  let best = Number.NEGATIVE_INFINITY;
  for (const id of candidateIds) {
    const value = metric(id);
    if (value > best) best = value;
  }
  return candidateIds.filter((id) => metric(id) === best).sort((a, b) => a.localeCompare(b));
}

/**
 * Campeão da Rodada derivado só do histórico FINISHED (sem campo persistido).
 * Critérios em ordem, só entre os ainda empatados:
 * 1) vitórias 2) saldo de gols 3) gols marcados 4) vitórias no confronto direto.
 * Empate total → "Empate na liderança". Nunca usa o vencedor da última partida.
 */
export function resolveRodadaChampion(input: {
  teams: ReadonlyArray<Pick<RodadaTeamInput, "id" | "name">>;
  finished: ReadonlyArray<RodadaFinishedMatchInput>;
}): RodadaChampion {
  const nameById = new Map(input.teams.map((team) => [team.id, team.name]));
  const standings = buildTeamStandings(
    input.teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: null,
      kind: "REGULAR" as const,
      initialQueuePosition: null,
    })),
    input.finished,
  );
  const standingById = new Map(standings.map((row) => [row.teamId, row]));

  const winsByTeam = countTeamWins(input.teams, input.finished);
  let bestWins = 0;
  for (const wins of winsByTeam.values()) {
    if (wins > bestWins) bestWins = wins;
  }

  if (bestWins <= 0) {
    return { kind: "undetermined", reason: "Nenhuma vitória registrada nesta sessão." };
  }

  let leaders = [...winsByTeam.entries()]
    .filter(([, wins]) => wins === bestWins)
    .map(([teamId]) => teamId)
    .sort((a, b) => a.localeCompare(b));

  let decidedBy: RodadaChampionDecidedBy = "wins";

  if (leaders.length > 1) {
    leaders = filterLeadersByMetric(
      leaders,
      (id) => standingById.get(id)?.goalDifference ?? 0,
    );
    decidedBy = "goalDifference";
  }

  if (leaders.length > 1) {
    leaders = filterLeadersByMetric(leaders, (id) => standingById.get(id)?.goalsFor ?? 0);
    decidedBy = "goalsFor";
  }

  if (leaders.length > 1) {
    const h2hWins = countHeadToHeadWinsAmong(leaders, input.finished);
    leaders = filterLeadersByMetric(leaders, (id) => h2hWins.get(id) ?? 0);
    decidedBy = "headToHead";
  }

  if (leaders.length > 1) {
    return {
      kind: "tied",
      teamIds: leaders,
      teamNames: leaders.map((id) => nameById.get(id) ?? id),
      wins: bestWins,
      reason: "Empate na liderança",
    };
  }

  const teamId = leaders[0];
  if (!teamId) {
    return { kind: "undetermined", reason: "Nenhuma vitória registrada nesta sessão." };
  }
  const row = standingById.get(teamId);
  return {
    kind: "determined",
    teamId,
    teamName: nameById.get(teamId) ?? teamId,
    wins: bestWins,
    goalsFor: row?.goalsFor ?? 0,
    goalsAgainst: row?.goalsAgainst ?? 0,
    goalDifference: row?.goalDifference ?? 0,
    decidedBy,
    reason: CHAMPION_REASON[decidedBy],
  };
}

export function aggregateSessionPlayerStats(input: {
  members: ReadonlyArray<{ memberId: string; name: string; nickname: string | null }>;
  events: ReadonlyArray<CountableEvent>;
  appearances: ReadonlyArray<{ memberId: string; matchId: string; teamId: string; role: "FIELD" | "GOALKEEPER" }>;
  matchResults: ReadonlyArray<{
    matchId: string;
    teamAId: string;
    teamBId: string;
    scoreA: number;
    scoreB: number;
    penaltyWinnerTeamId: string | null;
  }>;
}): RodadaPlayerStatRow[] {
  const byMember = aggregatePlayerStats({
    events: input.events,
    appearances: input.appearances,
    matchResults: input.matchResults,
    memberIds: input.members.map((member) => member.memberId),
  });

  return input.members
    .map((member) => ({
      memberId: member.memberId,
      name: member.name,
      nickname: member.nickname,
      totals: byMember.get(member.memberId) ?? emptyTotals(),
    }))
    .sort(
      (a, b) =>
        b.totals.goals - a.totals.goals ||
        b.totals.assists - a.totals.assists ||
        b.totals.bigMisses - a.totals.bigMisses ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

export type RodadaHighlightKind = "artilheiro" | "garcom" | "pereba";

export type RodadaHighlight = {
  kind: RodadaHighlightKind;
  label: string;
  /** Texto do estado vazio, ex.: "pixotadas". */
  metricLabel: string;
  /** null quando ninguém registrou a métrica (>0). */
  value: number | null;
  /** Linha de métrica amigável (ex.: "2 pixotadas" ou "1 gol contra · 1 pixotada"). */
  detail: string | null;
  /** Um ou mais líderes; vazio se value é null. */
  leaders: { memberId: string; name: string; nickname: string | null }[];
};

function leadersForMetric(
  rows: ReadonlyArray<RodadaPlayerStatRow>,
  metric: (row: RodadaPlayerStatRow) => number,
): { value: number | null; leaders: RodadaHighlight["leaders"] } {
  let best = 0;
  for (const row of rows) {
    const value = metric(row);
    if (value > best) best = value;
  }
  if (best <= 0) return { value: null, leaders: [] };
  return {
    value: best,
    leaders: rows
      .filter((row) => metric(row) === best)
      .map((row) => ({ memberId: row.memberId, name: row.name, nickname: row.nickname })),
  };
}

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Pior contribuição: mais pixotadas; desempate por gols contra; depois memberId. */
export function resolvePerebaLeaders(
  rows: ReadonlyArray<RodadaPlayerStatRow>,
): {
  value: number | null;
  detail: string | null;
  leaders: RodadaHighlight["leaders"];
  bigMisses: number;
  ownGoals: number;
} {
  let bestPix = 0;
  for (const row of rows) {
    if (row.totals.bigMisses > bestPix) bestPix = row.totals.bigMisses;
  }
  if (bestPix <= 0) {
    return { value: null, detail: null, leaders: [], bigMisses: 0, ownGoals: 0 };
  }

  let candidates = rows.filter((row) => row.totals.bigMisses === bestPix);
  let bestOwn = -1;
  for (const row of candidates) {
    if (row.totals.ownGoals > bestOwn) bestOwn = row.totals.ownGoals;
  }
  candidates = candidates
    .filter((row) => row.totals.ownGoals === bestOwn)
    .sort((a, b) => a.memberId.localeCompare(b.memberId));

  const sample = candidates[0]!;
  const parts: string[] = [];
  if (sample.totals.ownGoals > 0) {
    parts.push(formatCountLabel(sample.totals.ownGoals, "gol contra", "gols contra"));
  }
  parts.push(formatCountLabel(sample.totals.bigMisses, "pixotada", "pixotadas"));

  return {
    value: sample.totals.bigMisses,
    detail: parts.join(" · "),
    leaders: candidates.map((row) => ({
      memberId: row.memberId,
      name: row.name,
      nickname: row.nickname,
    })),
    bigMisses: sample.totals.bigMisses,
    ownGoals: sample.totals.ownGoals,
  };
}

/** Destaques da sessão: Artilheiro (gols), Garçom (assistências), Pereba (pixotadas). */
export function buildRodadaHighlights(
  rows: ReadonlyArray<RodadaPlayerStatRow>,
): RodadaHighlight[] {
  const artilheiro = leadersForMetric(rows, (row) => row.totals.goals);
  const garcom = leadersForMetric(rows, (row) => row.totals.assists);
  const pereba = resolvePerebaLeaders(rows);
  return [
    {
      kind: "artilheiro",
      label: "Artilheiro",
      metricLabel: "gols",
      value: artilheiro.value,
      detail:
        artilheiro.value == null
          ? null
          : formatCountLabel(artilheiro.value, "gol", "gols"),
      leaders: artilheiro.leaders,
    },
    {
      kind: "garcom",
      label: "Garçom",
      metricLabel: "assistências",
      value: garcom.value,
      detail:
        garcom.value == null
          ? null
          : formatCountLabel(garcom.value, "assistência", "assistências"),
      leaders: garcom.leaders,
    },
    {
      kind: "pereba",
      label: "Pereba",
      metricLabel: "pixotadas",
      value: pereba.value,
      detail: pereba.detail,
      leaders: pereba.leaders,
    },
  ];
}
