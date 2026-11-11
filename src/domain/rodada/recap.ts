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
  | { kind: "determined"; teamId: string; teamName: string; reason: "last_match_winner" }
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
 * Campeão da noite sob Rei da Mesa.
 *
 * O histórico persistido NÃO garante um campeão: o ADMIN escolhe confrontos
 * livremente (a sugestão pós-partida é opcional) e, ao encerrar a sessão,
 * partidas aguardando apito são apagadas — então o vencedor da última FINISHED
 * pode não ser o time que estava prestes a jogar. Sem campo persistido de
 * “Rei ao encerrar”, qualquer inferência seria chute → sempre Indeterminado.
 */
export function resolveRodadaChampion(input: {
  regularTeams: ReadonlyArray<{ id: string; name: string; initialQueuePosition: number }>;
  finished: ReadonlyArray<RodadaFinishedMatchInput>;
}): RodadaChampion {
  void input;
  return {
    kind: "undetermined",
    reason:
      "O Rei da Mesa não grava um campeão oficial da noite: confrontos são livres e o histórico finalizado sozinho não prova quem estava no comando ao encerrar.",
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
