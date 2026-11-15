// Regras puras de correção histórica de scouts (pós-finalização).
// Placar e desfecho vêm de eventos; a rotação Rei da Mesa só usa o desfecho
// (vencedor / empate), não o saldo de gols.

import {
  MatchQueueError,
  outcomeFromScore,
  scoreFromEvents,
  type MatchOutcome,
} from "./queue";
import { SCORING_EVENT_TYPES, type MatchEventType } from "./events";

export type ScoringEventLike = {
  type: string;
  teamId: string;
  voidedAt: Date | null;
};

export type OutcomeFingerprint = {
  scoreA: number;
  scoreB: number;
  kind: MatchOutcome["kind"];
  winnerId: string | null;
  loserId: string | null;
};

export function isScoringEventType(type: MatchEventType): boolean {
  return (SCORING_EVENT_TYPES as readonly string[]).includes(type);
}

export function fingerprintFromEvents(input: {
  teamCount: 3 | 4;
  teamAId: string;
  teamBId: string;
  penaltyWinnerTeamId: string | null;
  events: ReadonlyArray<ScoringEventLike>;
}): OutcomeFingerprint {
  const { scoreA, scoreB } = scoreFromEvents(input.events, input.teamAId, input.teamBId);
  const outcome = outcomeFromScore({
    teamCount: input.teamCount,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    scoreA,
    scoreB,
    penaltyWinnerTeamId: input.penaltyWinnerTeamId,
  });
  return fingerprintFromOutcome(scoreA, scoreB, outcome);
}

export function fingerprintFromOutcome(
  scoreA: number,
  scoreB: number,
  outcome: MatchOutcome,
): OutcomeFingerprint {
  if (outcome.kind === "DRAW_BOTH_OUT") {
    return { scoreA, scoreB, kind: outcome.kind, winnerId: null, loserId: null };
  }
  return {
    scoreA,
    scoreB,
    kind: outcome.kind,
    winnerId: outcome.winnerId,
    loserId: outcome.loserId,
  };
}

export function sameMatchOutcome(a: OutcomeFingerprint, b: OutcomeFingerprint): boolean {
  return a.kind === b.kind && a.winnerId === b.winnerId && a.loserId === b.loserId;
}

export function sameScore(a: OutcomeFingerprint, b: OutcomeFingerprint): boolean {
  return a.scoreA === b.scoreA && a.scoreB === b.scoreB;
}

export type ScoreCorrectionDecision =
  | { ok: true; scoreChanged: boolean; outcomeChanged: boolean }
  | {
      ok: false;
      message: string;
      /** Fluxo adicional que um Admin precisaria (não implementado). */
      requiredWorkflow: string;
    };

/**
 * Correções que mudam o desfecho (vencedor/empate) com partidas posteriores
 * já finalizadas invalidam a progressão persistida do Rei da Mesa.
 * Mudança só de placar com o mesmo desfecho é permitida (stats dinâmicas).
 */
export function decideScoreCorrection(input: {
  before: OutcomeFingerprint;
  after: OutcomeFingerprint;
  hasSubsequentFinishedMatches: boolean;
}): ScoreCorrectionDecision {
  const scoreChanged = !sameScore(input.before, input.after);
  const outcomeChanged = !sameMatchOutcome(input.before, input.after);

  if (!outcomeChanged) {
    return { ok: true, scoreChanged, outcomeChanged: false };
  }

  if (input.hasSubsequentFinishedMatches) {
    return {
      ok: false,
      message:
        "Esta correção mudaria o resultado da partida (vencedor ou empate), mas já existem partidas posteriores finalizadas nesta sessão. A progressão do Rei da Mesa e os times das partidas seguintes ficariam inconsistentes.",
      requiredWorkflow:
        "Seria necessário um fluxo dedicado de reconciliação da sessão: revisar/regravar confrontos posteriores (times, placares e fila), ou reabrir a noite com reset controlado — não disponível neste MVP de correção histórica.",
    };
  }

  return { ok: true, scoreChanged, outcomeChanged: true };
}

/** Valida se o placar/pênaltis formam um desfecho legal (ex.: empate 3 times). */
export function assertValidFinishedOutcome(input: {
  teamCount: 3 | 4;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  penaltyWinnerTeamId: string | null;
}): MatchOutcome {
  try {
    return outcomeFromScore(input);
  } catch (error) {
    if (error instanceof MatchQueueError) {
      throw error;
    }
    throw error;
  }
}

/** ElapsedSec retrospectivo: fim da partida (não inventa minuto intermediário). */
export function retrospectiveElapsedSec(input: {
  startedAt: Date;
  endedAt: Date | null;
  pausedTotalMs: number;
  plannedDurationSec: number;
}): number {
  if (input.endedAt) {
    return Math.max(
      0,
      Math.floor(
        (input.endedAt.getTime() - input.startedAt.getTime() - input.pausedTotalMs) / 1000,
      ),
    );
  }
  return Math.max(0, input.plannedDurationSec);
}
