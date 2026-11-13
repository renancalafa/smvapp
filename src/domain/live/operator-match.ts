/**
 * Resolve qual partida o operador deve ver no Ao Vivo.
 * `boardCurrent` vem do servidor (poll); `bridge` é só o MatchView pós-apito
 * até o poll refletir a partida — nunca deve manter uma partida já finalizada.
 */
export function resolveOperatorLiveMatch<T extends { id: string; sequence: number; status: string }>(input: {
  boardCurrent: T | null;
  bridge: T | null;
  historyIds: ReadonlySet<string> | readonly string[];
  nextSequence: number;
}): T | null {
  const history =
    input.historyIds instanceof Set ? input.historyIds : new Set(input.historyIds);

  const boardLive =
    input.boardCurrent && input.boardCurrent.status === "IN_PROGRESS" ? input.boardCurrent : null;
  if (boardLive) return boardLive;

  const bridge = input.bridge;
  if (!bridge) return null;
  if (bridge.status !== "IN_PROGRESS") return null;
  if (history.has(bridge.id)) return null;
  if (input.nextSequence > bridge.sequence) return null;
  return bridge;
}

/** Bridge ficou obsoleto e deve ser descartado (servidor já reconciliou ou partida morreu). */
export function isOperatorBridgeStale<T extends { id: string; sequence: number; status: string }>(input: {
  boardCurrent: T | null;
  bridge: T;
  historyIds: ReadonlySet<string> | readonly string[];
  nextSequence: number;
}): boolean {
  const history =
    input.historyIds instanceof Set ? input.historyIds : new Set(input.historyIds);
  if (input.bridge.status !== "IN_PROGRESS") return true;
  if (history.has(input.bridge.id)) return true;
  if (input.nextSequence > input.bridge.sequence) return true;
  if (input.boardCurrent?.id === input.bridge.id) return true;
  return false;
}
