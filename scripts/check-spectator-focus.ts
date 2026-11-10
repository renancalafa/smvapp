// SOMENTE DESENVOLVIMENTO: regressão da seleção de sessão do Ao Vivo.
//
//   npm run check:spectator-focus
import {
  decideInProgressSpectatorFocus,
  playWindowEndMs,
  RECENT_ENDED_MS,
  selectSpectatorFocus,
  type SpectatorFocusSessionInput,
} from "../src/domain/live/spectator-focus";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const hour = 3_600_000;
const now = Date.parse("2026-11-10T12:00:00.000Z");
const maxExtraMinutes = 30;

function session(
  partial: Partial<SpectatorFocusSessionInput> & Pick<SpectatorFocusSessionInput, "id" | "status">,
): SpectatorFocusSessionInput {
  return {
    startsAtMs: now - 2 * hour,
    endsAtMs: now - hour,
    maxExtraMinutes,
    finishedAtMs: null,
    hasActiveMatch: false,
    ...partial,
  };
}

function domainChecks() {
  check(
    "playWindowEnd = endsAt + maxExtra",
    playWindowEndMs(1_000_000, 30) === 1_000_000 + 30 * 60_000,
  );
  check("RECENT_ENDED_MS = 12h", RECENT_ENDED_MS === 12 * hour);

  const endsAtMs = now - hour;
  const windowEnd = playWindowEndMs(endsAtMs, maxExtraMinutes);

  check(
    "IN_PROGRESS within window → live",
    decideInProgressSpectatorFocus({
      nowMs: windowEnd - 60_000,
      endsAtMs,
      maxExtraMinutes,
      hasActiveMatch: false,
    }) === "live",
  );

  check(
    "IN_PROGRESS after window, no active match, within 12h → ended",
    decideInProgressSpectatorFocus({
      nowMs: windowEnd + hour,
      endsAtMs,
      maxExtraMinutes,
      hasActiveMatch: false,
    }) === "ended",
  );

  check(
    "IN_PROGRESS after window with active match → live",
    decideInProgressSpectatorFocus({
      nowMs: windowEnd + 2 * hour,
      endsAtMs,
      maxExtraMinutes,
      hasActiveMatch: true,
    }) === "live",
  );

  check(
    "IN_PROGRESS old (past 12h after window), no match → stale",
    decideInProgressSpectatorFocus({
      nowMs: windowEnd + RECENT_ENDED_MS + hour,
      endsAtMs,
      maxExtraMinutes,
      hasActiveMatch: false,
    }) === "stale",
  );

  // --- selectSpectatorFocus (algoritmo completo) ---

  const liveInWindow = session({
    id: "in-window",
    status: "IN_PROGRESS",
    startsAtMs: now - hour,
    endsAtMs: now + hour,
    hasActiveMatch: false,
  });
  check(
    "select: IN_PROGRESS within window → live",
    (() => {
      const focus = selectSpectatorFocus([liveInWindow], now);
      return focus.kind === "live" && focus.sessionId === "in-window";
    })(),
  );

  const expiredNoMatch = session({
    id: "expired-nov5",
    status: "IN_PROGRESS",
    startsAtMs: now - 5 * 24 * hour,
    endsAtMs: now - 5 * 24 * hour + 90 * 60_000,
    maxExtraMinutes: 30,
    hasActiveMatch: false,
  });
  check(
    "select: IN_PROGRESS after window, no active match → ended (≤12h) or idle",
    (() => {
      const recent = selectSpectatorFocus(
        [
          session({
            id: "recent-expired",
            status: "IN_PROGRESS",
            startsAtMs: now - 3 * hour,
            endsAtMs: now - 2 * hour,
            hasActiveMatch: false,
          }),
        ],
        now,
      );
      return recent.kind === "ended" && recent.sessionId === "recent-expired";
    })(),
  );

  check(
    "select: IN_PROGRESS after window with active match → live",
    (() => {
      const focus = selectSpectatorFocus(
        [
          session({
            id: "overtime",
            status: "IN_PROGRESS",
            startsAtMs: now - 3 * hour,
            endsAtMs: now - 2 * hour,
            hasActiveMatch: true,
          }),
        ],
        now,
      );
      return focus.kind === "live" && focus.sessionId === "overtime";
    })(),
  );

  const finishedRecently = session({
    id: "finished-recent",
    status: "FINISHED",
    startsAtMs: now - 4 * hour,
    endsAtMs: now - 2 * hour,
    finishedAtMs: now - hour,
    hasActiveMatch: false,
  });
  check(
    "select: recently FINISHED → ended",
    (() => {
      const focus = selectSpectatorFocus([finishedRecently], now);
      return focus.kind === "ended" && focus.sessionId === "finished-recent";
    })(),
  );

  check(
    "select: old IN_PROGRESS (stale) → idle",
    (() => {
      const focus = selectSpectatorFocus([expiredNoMatch], now);
      return focus.kind === "idle";
    })(),
  );

  const upcoming = session({
    id: "nov12",
    status: "LOCKED",
    startsAtMs: now + 2 * 24 * hour,
    endsAtMs: now + 2 * 24 * hour + 90 * 60_000,
    hasActiveMatch: false,
  });
  check(
    "select: upcoming session unaffected (stays idle with only future session)",
    selectSpectatorFocus([upcoming], now).kind === "idle",
  );

  check(
    "select: stale IN_PROGRESS does not hide upcoming when upcoming is not started",
    (() => {
      const focus = selectSpectatorFocus([expiredNoMatch, upcoming], now);
      return focus.kind === "idle";
    })(),
  );

  check(
    "select: CANCELLED never selected",
    selectSpectatorFocus(
      [
        session({
          id: "cancelled",
          status: "CANCELLED",
          startsAtMs: now - hour,
          endsAtMs: now + hour,
        }),
      ],
      now,
    ).kind === "idle",
  );

  check(
    "select: OPEN/LOCKED in window still live (non-IN_PROGRESS path)",
    (() => {
      const focus = selectSpectatorFocus(
        [
          session({
            id: "locked-now",
            status: "LOCKED",
            startsAtMs: now - 30 * 60_000,
            endsAtMs: now + hour,
          }),
        ],
        now,
      );
      return focus.kind === "live" && focus.sessionId === "locked-now";
    })(),
  );

  check(
    "select: stale IN_PROGRESS does not block recently FINISHED",
    (() => {
      const focus = selectSpectatorFocus([expiredNoMatch, finishedRecently], now);
      return focus.kind === "ended" && focus.sessionId === "finished-recent";
    })(),
  );
}

domainChecks();

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
