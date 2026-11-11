import Link from "next/link";
import { TeamBadge } from "@/components/team-badge";
import { darkEmpty, darkMuted, darkSectionLabel } from "@/lib/ui/dark-surfaces";
import type { RodadaRecap } from "@/server/modules/rodada/queries";
import { formatSessionTitle } from "./sessions/format";

function playerLabel(name: string, nickname: string | null): string {
  return nickname ? `${name} (${nickname})` : name;
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

export function HomeLastSessionCard({
  recap,
  timeZone,
}: {
  recap: RodadaRecap | null;
  timeZone: string;
}) {
  if (!recap) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-white">Última pelada</h2>
        <div className={darkEmpty}>Ainda não há sessão encerrada para resumir.</div>
      </section>
    );
  }

  const startsAt = new Date(recap.startsAt);
  const champion = recap.champion;
  const championTeam =
    champion.kind === "determined"
      ? recap.teams.find((team) => team.id === champion.teamId)
      : null;
  const standing =
    champion.kind === "determined"
      ? recap.standings.find((row) => row.teamId === champion.teamId)
      : null;

  const summaryBits: string[] = [];
  if (standing) {
    summaryBits.push(
      `${standing.wins} vitória${standing.wins === 1 ? "" : "s"}`,
      `${standing.draws} empate${standing.draws === 1 ? "" : "s"}`,
      `${standing.losses} derrota${standing.losses === 1 ? "" : "s"}`,
      `${standing.goalsFor} gols pró`,
      `${standing.goalsAgainst} contra`,
    );
  }

  const miniHighlights = recap.highlights.filter((item) => item.value != null).slice(0, 3);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Última pelada</h2>
        <Link
          href="/rodada"
          className="text-sm font-medium text-smv-gold-bright hover:text-smv-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
        >
          Ver Rodada ›
        </Link>
      </div>

      <Link
        href="/rodada"
        className="relative block overflow-hidden rounded-3xl border border-white/10 bg-smv-navy-card p-4 shadow-sm ring-1 ring-white/5 transition-colors active:bg-smv-navy-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold sm:p-5"
      >
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{
            backgroundColor:
              championTeam?.color ??
              (recap.champion.kind === "tied" ? "rgba(255,255,255,0.35)" : "#c9a227"),
          }}
          aria-hidden
        />

        <p className={darkSectionLabel}>{formatSessionTitle(startsAt, timeZone)}</p>

        {champion.kind === "determined" && championTeam ? (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-smv-gold">
              Campeão
            </p>
            <p className="mt-1 text-2xl font-semibold text-white">
              <TeamBadge
                name={championTeam.name}
                color={championTeam.color}
                position={championTeam.initialQueuePosition}
                size="md"
                className="text-2xl"
              />
            </p>
            {championTeam.players.length > 0 && (
              <p className={`mt-2 line-clamp-2 text-sm ${darkMuted}`}>
                {championTeam.players
                  .map((player) => playerLabel(player.name, player.nickname))
                  .join(" · ")}
              </p>
            )}
            {summaryBits.length > 0 && (
              <p className="mt-3 text-sm font-medium tabular-nums text-white/80">
                {summaryBits.join(" · ")}
                {standing ? ` · SG ${formatSigned(standing.goalDifference)}` : ""}
              </p>
            )}
          </>
        ) : champion.kind === "tied" ? (
          <>
            <p className="mt-2 text-xl font-semibold text-white">Empate na liderança</p>
            <p className={`mt-1 text-sm ${darkMuted}`}>{champion.teamNames.join(", ")}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-xl font-semibold text-white">Campeão indeterminado</p>
            <p className={`mt-1 text-sm ${darkMuted}`}>{champion.reason}</p>
          </>
        )}

        {miniHighlights.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {miniHighlights.map((highlight) => (
              <li
                key={highlight.kind}
                className="rounded-xl bg-black/25 px-3 py-2 ring-1 ring-white/10"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  {highlight.label}
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-white">
                  {highlight.leaders.length === 1
                    ? playerLabel(highlight.leaders[0]!.name, highlight.leaders[0]!.nickname)
                    : "Empate"}
                </p>
                <p className="text-xs tabular-nums text-smv-gold-bright">
                  {highlight.detail ?? `${highlight.value} ${highlight.metricLabel}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Link>
    </section>
  );
}
