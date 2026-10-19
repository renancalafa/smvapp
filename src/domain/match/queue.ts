// Rei da Mesa (PROJECT.md, seções 21 a 23). Função pura.
// Revisão 20/21: o ADMIN escolhe livremente qualquer dois times elegíveis. A
// initialQueuePosition NÃO força o primeiro confronto; só ordena a fila de espera
// quando não há histórico. O histórico real (quem jogou e o placar) determina a
// sugestão seguinte; o ADMIN pode ignorar a sugestão.

export type QueueTeam = { id: string; initialQueuePosition: number };

export type MatchOutcome =
  | { kind: "WIN"; winnerId: string; loserId: string }
  | { kind: "DRAW_BOTH_OUT" }
  | { kind: "PENALTY_WIN"; winnerId: string; loserId: string };

export type Matchup = { teamAId: string; teamBId: string; waiting: QueueTeam[] };

export class MatchQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchQueueError";
  }
}

/** Times REGULAR ordenados pela posição do sorteio (só desempate / ordem da espera). */
export function sortRegularTeams(teams: QueueTeam[]): QueueTeam[] {
  return [...teams].sort(
    (a, b) =>
      a.initialQueuePosition - b.initialQueuePosition || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function assertTeamCount(count: number): asserts count is 3 | 4 {
  if (count !== 3 && count !== 4) {
    throw new MatchQueueError(`O Rei da Mesa exige 3 ou 4 times regulares (há ${count}).`);
  }
}

function asQueueTeam(id: string, positions: ReadonlyMap<string, number>): QueueTeam {
  const initialQueuePosition = positions.get(id);
  if (initialQueuePosition === undefined) {
    throw new MatchQueueError("Time desconhecido na rotação do Rei da Mesa.");
  }
  return { id, initialQueuePosition };
}

/** Fila de espera = todos os regulares que não estão em campo, preservando ordem anterior. */
export function waitingForMatchup(
  regularTeams: QueueTeam[],
  teamAId: string,
  teamBId: string,
  previousWaiting: QueueTeam[] | null,
): QueueTeam[] {
  if (teamAId === teamBId) throw new MatchQueueError("Os dois lados da partida devem ser times distintos.");
  const onField = new Set([teamAId, teamBId]);
  const known = new Set(regularTeams.map((team) => team.id));
  if (!known.has(teamAId) || !known.has(teamBId)) {
    throw new MatchQueueError("Só times regulares da sessão podem jogar.");
  }
  const out = regularTeams.filter((team) => !onField.has(team.id));
  if (!previousWaiting) return sortRegularTeams(out);
  const result: QueueTeam[] = [];
  for (const team of previousWaiting) {
    if (!onField.has(team.id) && out.some((candidate) => candidate.id === team.id)) {
      result.push(team);
    }
  }
  for (const team of sortRegularTeams(out)) {
    if (!result.some((candidate) => candidate.id === team.id)) result.push(team);
  }
  return result;
}

/**
 * Próximo confronto sugerido depois de uma partida finalizada.
 * Em 4 times, empate tira os dois e coloca os dois que esperavam.
 * Em 3 times, empate sem vencedor nos pênaltis não é válido (use PENALTY_WIN).
 */
export function suggestNextMatch(input: {
  teamCount: 3 | 4;
  teamAId: string;
  teamBId: string;
  waiting: QueueTeam[];
  positions: ReadonlyMap<string, number>;
  outcome: MatchOutcome;
}): Matchup {
  const { teamCount, teamAId, teamBId, waiting, positions, outcome } = input;
  if (teamAId === teamBId) throw new MatchQueueError("Os dois lados da partida devem ser times distintos.");
  if (waiting.some((team) => team.id === teamAId || team.id === teamBId)) {
    throw new MatchQueueError("Um time em campo não pode estar na fila de espera.");
  }
  if (teamCount === 3 && waiting.length !== 1) {
    throw new MatchQueueError("Com 3 times, a fila de espera deve ter exatamente 1 time.");
  }
  if (teamCount === 4 && waiting.length !== 2) {
    throw new MatchQueueError("Com 4 times, a fila de espera deve ter exatamente 2 times.");
  }

  if (outcome.kind === "DRAW_BOTH_OUT") {
    if (teamCount !== 4) {
      throw new MatchQueueError("Com 3 times, empate exige vencedor nos pênaltis.");
    }
    const nextA = waiting[0];
    const nextB = waiting[1];
    if (!nextA || !nextB) throw new MatchQueueError("Não há dois times na espera para entrar.");
    return {
      teamAId: nextA.id,
      teamBId: nextB.id,
      waiting: [asQueueTeam(teamAId, positions), asQueueTeam(teamBId, positions)],
    };
  }

  const { winnerId, loserId } = outcome;
  if (winnerId === loserId) throw new MatchQueueError("Vencedor e perdedor devem ser distintos.");
  if (
    !(
      (winnerId === teamAId && loserId === teamBId) ||
      (winnerId === teamBId && loserId === teamAId)
    )
  ) {
    throw new MatchQueueError("Vencedor e perdedor devem ser os times desta partida.");
  }
  const next = waiting[0];
  if (!next) throw new MatchQueueError("Não há time na espera para entrar.");

  return {
    teamAId: winnerId === teamAId ? teamAId : next.id,
    teamBId: winnerId === teamBId ? teamBId : next.id,
    waiting: [...waiting.slice(1), asQueueTeam(loserId, positions)],
  };
}

export function scoreFromEvents(
  events: ReadonlyArray<{ type: string; teamId: string; voidedAt: Date | null }>,
  teamAId: string,
  teamBId: string,
): { scoreA: number; scoreB: number } {
  let scoreA = 0;
  let scoreB = 0;
  for (const event of events) {
    if (event.voidedAt) continue;
    // Só GOAL e OWN_GOAL alteram placar; cartões, pixotada, trave e desarme não.
    if (event.type === "GOAL") {
      if (event.teamId === teamAId) scoreA++;
      else if (event.teamId === teamBId) scoreB++;
      continue;
    }
    if (event.type === "OWN_GOAL") {
      // Autor no time X → crédito no adversário.
      if (event.teamId === teamAId) scoreB++;
      else if (event.teamId === teamBId) scoreA++;
    }
  }
  return { scoreA, scoreB };
}

export function outcomeFromScore(input: {
  teamCount: 3 | 4;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
}): MatchOutcome {
  const { teamCount, teamAId, teamBId, scoreA, scoreB, penaltyWinnerTeamId } = input;
  if (scoreA > scoreB) return { kind: "WIN", winnerId: teamAId, loserId: teamBId };
  if (scoreB > scoreA) return { kind: "WIN", winnerId: teamBId, loserId: teamAId };
  if (teamCount === 4) return { kind: "DRAW_BOTH_OUT" };
  if (!penaltyWinnerTeamId) {
    throw new MatchQueueError("Empate com 3 times: registre o vencedor nos pênaltis antes de finalizar.");
  }
  if (penaltyWinnerTeamId !== teamAId && penaltyWinnerTeamId !== teamBId) {
    throw new MatchQueueError("O vencedor nos pênaltis deve ser um dos times da partida.");
  }
  return {
    kind: "PENALTY_WIN",
    winnerId: penaltyWinnerTeamId,
    loserId: penaltyWinnerTeamId === teamAId ? teamBId : teamAId,
  };
}

/**
 * Sugestão do próximo confronto a partir das partidas REALMENTE jogadas.
 * Sem histórico: null (o ADMIN escolhe livremente; a UI pode mostrar um hint fraco).
 * Com histórico: aplica o Rei da Mesa usando quem esteve em campo e a fila reconstruída.
 */
export function suggestMatchupAfterHistory(input: {
  regularTeams: QueueTeam[];
  finished: ReadonlyArray<{
    teamAId: string;
    teamBId: string;
    scoreA: number;
    scoreB: number;
    penaltyWinnerTeamId: string | null;
  }>;
}): Matchup | null {
  assertTeamCount(input.regularTeams.length);
  if (input.finished.length === 0) return null;

  const teamCount = input.regularTeams.length;
  const positions = new Map(input.regularTeams.map((team) => [team.id, team.initialQueuePosition]));
  let previousWaiting: QueueTeam[] | null = null;
  let suggested: Matchup | null = null;

  for (const match of input.finished) {
    const waiting = waitingForMatchup(input.regularTeams, match.teamAId, match.teamBId, previousWaiting);
    const outcome = outcomeFromScore({
      teamCount,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    });
    suggested = suggestNextMatch({
      teamCount,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      waiting,
      positions,
      outcome,
    });
    previousWaiting = suggested.waiting;
  }
  return suggested;
}

/** Hint fraco para a UI quando ainda não há partidas (não é obrigatório). */
export function softFirstMatchHint(regularTeams: QueueTeam[]): Matchup | null {
  const ordered = sortRegularTeams(regularTeams);
  if (ordered.length !== 3 && ordered.length !== 4) return null;
  return {
    teamAId: ordered[0].id,
    teamBId: ordered[1].id,
    waiting: ordered.slice(2),
  };
}
