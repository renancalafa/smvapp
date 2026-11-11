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
};

export type RodadaHeadToHeadCell = {
  rowTeamId: string;
  colTeamId: string;
  /** null = sem confronto FINISHED entre o par (ou célula diagonal). */
  score: { for: number; against: number; penaltyWin: boolean } | null;
};

export type RodadaChampion =
  | { kind: "determined"; teamId: string; teamName: string; wins: number }
  | {
      kind: "tied";
      teamIds: string[];
      teamNames: string[];
      wins: number;
      reason: "Empate na liderança";
    }
  | { kind: "undetermined"; reason: string };

export type RodadaPlayerStatRow = {
  memberId: string;
  name: string;
  nickname: string | null;
  totals: PlayerStatTotals;
};

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

  return [...byId.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
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
 * Campeão da Rodada = time com mais vitórias em partidas FINISHED.
 * WIN e PENALTY_WIN (via individualResultForTeam) contam 1 vitória; empates não.
 * Não usa o vencedor da última partida. Não persiste campo — só deriva.
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

export function resolveRodadaChampion(input: {
  teams: ReadonlyArray<Pick<RodadaTeamInput, "id" | "name">>;
  finished: ReadonlyArray<RodadaFinishedMatchInput>;
}): RodadaChampion {
  const winsByTeam = countTeamWins(input.teams, input.finished);
  const nameById = new Map(input.teams.map((team) => [team.id, team.name]));

  let bestWins = 0;
  for (const wins of winsByTeam.values()) {
    if (wins > bestWins) bestWins = wins;
  }

  if (bestWins <= 0) {
    return { kind: "undetermined", reason: "Nenhuma vitória registrada nesta sessão." };
  }

  const leaders = [...winsByTeam.entries()]
    .filter(([, wins]) => wins === bestWins)
    .map(([teamId]) => teamId)
    .sort((a, b) => (nameById.get(a) ?? a).localeCompare(nameById.get(b) ?? b, "pt-BR"));

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
  return {
    kind: "determined",
    teamId,
    teamName: nameById.get(teamId) ?? teamId,
    wins: bestWins,
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
