// Regressão pura do modo exclusivo Rodada ↔ Ao Vivo.
//
//   npm run check:night-mode
import {
  isActiveDecidedDraw,
  nightNavItem,
  resolveNightNavMode,
  selectLatestFinishedSession,
  type NightModeDraw,
  type NightModeSession,
} from "../src/domain/nav/night-mode";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const t0 = Date.parse("2026-11-01T21:00:00.000Z");
const t1 = Date.parse("2026-11-08T21:00:00.000Z");
const t2 = Date.parse("2026-11-15T21:00:00.000Z");

function session(
  partial: Partial<NightModeSession> & Pick<NightModeSession, "id" | "status">,
): NightModeSession {
  return {
    startsAtMs: t1,
    finishedAtMs: null,
    ...partial,
  };
}

function draw(
  partial: Partial<NightModeDraw> & Pick<NightModeDraw, "gameSessionId" | "status">,
): NightModeDraw {
  return {
    invalidatedAtMs: null,
    winningOptionId: null,
    ...partial,
  };
}

{
  const mode = resolveNightNavMode([], []);
  check("sem sessões → rodada vazia", mode.kind === "rodada" && mode.finishedSessionId === null);
  check("nav item padrão Rodada", nightNavItem(mode).href === "/rodada" && nightNavItem(mode).label === "Rodada");
}

{
  const older = session({
    id: "fin-old",
    status: "FINISHED",
    startsAtMs: t0,
    finishedAtMs: t0 + 3_600_000,
  });
  const newer = session({
    id: "fin-new",
    status: "FINISHED",
    startsAtMs: t1,
    finishedAtMs: t1 + 3_600_000,
  });
  const mode = resolveNightNavMode([older, newer], []);
  check(
    "FINISHED mais recente por finishedAt",
    mode.kind === "rodada" && mode.finishedSessionId === "fin-new",
  );
  check(
    "selectLatestFinishedSession",
    selectLatestFinishedSession([older, newer])?.id === "fin-new",
  );
}

{
  const open = session({ id: "open-1", status: "OPEN", startsAtMs: t2 });
  for (const status of ["VOTING", "TIED"] as const) {
    const mode = resolveNightNavMode(
      [open],
      [draw({ gameSessionId: "open-1", status, winningOptionId: null })],
    );
    check(`${status} não abre Ao Vivo`, mode.kind === "rodada");
  }
  check(
    "DECIDED sem winningOptionId não abre Ao Vivo",
    resolveNightNavMode(
      [open],
      [draw({ gameSessionId: "open-1", status: "DECIDED", winningOptionId: null })],
    ).kind === "rodada",
  );
}

{
  const open = session({ id: "open-2", status: "OPEN", startsAtMs: t2 });
  const mode = resolveNightNavMode(
    [open],
    [draw({ gameSessionId: "open-2", status: "DECIDED", winningOptionId: "opt-a" })],
  );
  check("DECIDED com winningOptionId → Ao Vivo", mode.kind === "ao_vivo" && mode.liveSessionId === "open-2");
  check("nav item Ao Vivo", nightNavItem(mode).href === "/live");
}

{
  const open = session({ id: "auto", status: "SCHEDULED", startsAtMs: t2 });
  const mode = resolveNightNavMode(
    [open],
    [
      draw({
        gameSessionId: "auto",
        status: "DECIDED",
        winningOptionId: "opt-single",
      }),
    ],
  );
  check("auto-DECIDED (opção única) → Ao Vivo", mode.kind === "ao_vivo" && mode.liveSessionId === "auto");
}

{
  const open = session({ id: "inv", status: "OPEN", startsAtMs: t2 });
  const finished = session({
    id: "prev",
    status: "FINISHED",
    startsAtMs: t1,
    finishedAtMs: t1 + 3_600_000,
  });
  const mode = resolveNightNavMode(
    [open, finished],
    [
      draw({
        gameSessionId: "inv",
        status: "DECIDED",
        winningOptionId: "opt-a",
        invalidatedAtMs: t2 + 60_000,
      }),
    ],
  );
  check(
    "invalidação de DECIDED volta à Rodada do FINISHED",
    mode.kind === "rodada" && mode.finishedSessionId === "prev",
  );
  check(
    "isActiveDecidedDraw rejeita invalidado",
    !isActiveDecidedDraw(
      draw({
        gameSessionId: "inv",
        status: "DECIDED",
        winningOptionId: "opt-a",
        invalidatedAtMs: t2,
      }),
    ),
  );
}

{
  const finished = session({
    id: "done",
    status: "FINISHED",
    startsAtMs: t1,
    finishedAtMs: t1 + 3_600_000,
  });
  const mode = resolveNightNavMode(
    [finished],
    [draw({ gameSessionId: "done", status: "DECIDED", winningOptionId: "opt-a" })],
  );
  check("FINISHED com DECIDED → Rodada (não Ao Vivo)", mode.kind === "rodada" && mode.finishedSessionId === "done");
}

{
  const cancelled = session({ id: "can", status: "CANCELLED", startsAtMs: t2 });
  const mode = resolveNightNavMode(
    [cancelled],
    [draw({ gameSessionId: "can", status: "DECIDED", winningOptionId: "opt-a" })],
  );
  check("CANCELLED nunca é Ao Vivo", mode.kind === "rodada" && mode.finishedSessionId === null);
}

{
  const stuck = session({ id: "stuck", status: "IN_PROGRESS", startsAtMs: t0 });
  const mode = resolveNightNavMode(
    [stuck],
    [draw({ gameSessionId: "stuck", status: "DECIDED", winningOptionId: "opt-a" })],
  );
  check("IN_PROGRESS preso com DECIDED permanece Ao Vivo", mode.kind === "ao_vivo" && mode.liveSessionId === "stuck");
}

{
  const olderLive = session({ id: "live-old", status: "OPEN", startsAtMs: t1 });
  const newerLive = session({ id: "live-new", status: "OPEN", startsAtMs: t2 });
  const mode = resolveNightNavMode(
    [olderLive, newerLive],
    [
      draw({ gameSessionId: "live-old", status: "DECIDED", winningOptionId: "a" }),
      draw({ gameSessionId: "live-new", status: "DECIDED", winningOptionId: "b" }),
    ],
  );
  check(
    "sobreposição: Ao Vivo = startsAt mais recente",
    mode.kind === "ao_vivo" && mode.liveSessionId === "live-new",
  );
}

{
  const voting = session({ id: "vote", status: "OPEN", startsAtMs: t2 });
  const finished = session({
    id: "fin",
    status: "FINISHED",
    startsAtMs: t1,
    finishedAtMs: t1 + 1,
  });
  const mode = resolveNightNavMode(
    [voting, finished],
    [draw({ gameSessionId: "vote", status: "VOTING" })],
  );
  check(
    "votação em curso: Rodada do último FINISHED",
    mode.kind === "rodada" && mode.finishedSessionId === "fin",
  );
}

{
  // Deep-link / nav consistency: nightNavItem is the single source for href/label.
  const rodada = resolveNightNavMode([], []);
  const aoVivo = resolveNightNavMode(
    [session({ id: "x", status: "OPEN", startsAtMs: t2 })],
    [draw({ gameSessionId: "x", status: "DECIDED", winningOptionId: "o" })],
  );
  check("deep-link Rodada → /rodada", nightNavItem(rodada).href === "/rodada");
  check("deep-link Ao Vivo → /live", nightNavItem(aoVivo).href === "/live");
  check(
    "desktop/mobile usam o mesmo nightNavItem",
    nightNavItem(aoVivo).label === "Ao Vivo" && nightNavItem(rodada).label === "Rodada",
  );
}

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
