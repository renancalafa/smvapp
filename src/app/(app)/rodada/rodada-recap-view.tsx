import { TeamBadge } from "@/components/team-badge";
import {
  darkCardPad,
  darkEmpty,
  darkMuted,
  darkSectionLabel,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import type { RodadaRecap } from "@/server/modules/rodada/queries";
import { extraordinaryLabel, formatSessionTitle, formatTime } from "../sessions/format";

function playerLabel(name: string, nickname: string | null): string {
  return nickname ? `${name} (${nickname})` : name;
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function rankLabel(rank: number, tied: boolean): string {
  return `${rank}º${tied ? "=" : ""}`;
}

function teamMeta(recap: RodadaRecap, teamId: string) {
  return recap.teams.find((team) => team.id === teamId) ?? null;
}

export function RodadaRecapView({
  recap,
  timeZone,
}: {
  recap: RodadaRecap | null;
  timeZone: string;
}) {
  if (!recap) {
    return (
      <section className="flex flex-col gap-4 text-smv-cream">
        <header>
          <h1 className={darkTitle}>Rodada</h1>
          <p className={`mt-1 ${darkMuted}`}>Resumo da sessão oficialmente encerrada.</p>
        </header>
        <div className={darkEmpty}>
          Ainda não há sessão concluída. Quando o admin encerrar a pelada, o recap aparece aqui.
        </div>
      </section>
    );
  }

  const startsAt = new Date(recap.startsAt);
  const endsAt = new Date(recap.endsAt);
  const extra = extraordinaryLabel(recap.origin);

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className={darkTitle}>Rodada</h1>
          <p className="mt-1 text-lg font-medium text-white">
            {formatSessionTitle(startsAt, timeZone)}
            {extra ? ` · ${extra}` : ""}
          </p>
          <p className={darkMuted}>
            {formatTime(startsAt, timeZone)} – {formatTime(endsAt, timeZone)}
            {recap.venueName ? ` · ${recap.venueName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-smv-gold/15 px-3 py-1.5 font-medium text-smv-gold-bright ring-1 ring-smv-gold/30">
            {recap.playerCount} jogadores
          </span>
          <span className="rounded-lg bg-white/8 px-3 py-1.5 text-white/70 ring-1 ring-white/10">
            {recap.matches.length} partida{recap.matches.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {recap.incompleteNote && (
        <p className="rounded-xl border border-dashed border-smv-gold/35 bg-smv-gold/10 px-4 py-3 text-sm text-smv-gold-bright">
          {recap.incompleteNote}
        </p>
      )}

      <ChampionCard recap={recap} />

      <HighlightsGrid recap={recap} />

      <StandingsList recap={recap} />

      <details className="group rounded-2xl border border-white/10 bg-smv-navy-card open:pb-4">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-white marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            Resultados
            <span className="text-xs font-medium text-white/45 group-open:hidden">mostrar</span>
            <span className="hidden text-xs font-medium text-white/45 group-open:inline">ocultar</span>
          </span>
        </summary>
        <div className="px-4">
          {recap.matches.length === 0 ? (
            <div className={darkEmpty}>Nenhuma partida finalizada nesta sessão.</div>
          ) : (
            <ul className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10 bg-black/20">
              {recap.matches.map((match) => {
                const teamA = teamMeta(recap, match.teamAId);
                const teamB = teamMeta(recap, match.teamBId);
                return (
                  <li key={match.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-7 shrink-0 text-xs font-semibold text-white/40">
                      #{match.sequence}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-white">
                        <TeamBadge
                          name={match.teamAName}
                          color={teamA?.color ?? null}
                          position={teamA?.initialQueuePosition}
                        />
                        <span className="tabular-nums text-smv-gold-bright">
                          {match.scoreA}–{match.scoreB}
                        </span>
                        <TeamBadge
                          name={match.teamBName}
                          color={teamB?.color ?? null}
                          position={teamB?.initialQueuePosition}
                        />
                      </p>
                      {match.penaltyWinnerTeamId && (
                        <p className="mt-0.5 text-xs text-white/45">
                          Pênaltis:{" "}
                          {teamMeta(recap, match.penaltyWinnerTeamId)?.name ?? "—"}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      <details className="group rounded-2xl border border-white/10 bg-smv-navy-card open:pb-4">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-white marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            Confrontos diretos
            <span className="text-xs font-medium text-white/45 group-open:hidden">mostrar</span>
            <span className="hidden text-xs font-medium text-white/45 group-open:inline">ocultar</span>
          </span>
        </summary>
        <div className="px-4">
          <p className={`mb-3 text-sm ${darkMuted}`}>
            Placar do confronto FINISHED mais recente entre o time da linha e o da coluna.
          </p>
          <HeadToHeadTable recap={recap} />
        </div>
      </details>

      <details className="group rounded-2xl border border-white/10 bg-smv-navy-card open:pb-4">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-white marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            Escalações
            <span className="text-xs font-medium text-white/45 group-open:hidden">mostrar</span>
            <span className="hidden text-xs font-medium text-white/45 group-open:inline">ocultar</span>
          </span>
        </summary>
        <div className="grid gap-3 px-4 sm:grid-cols-2">
          {recap.teams.map((team) => (
            <article key={team.id} className={darkCardPad}>
              <h3 className="mb-2 font-semibold text-white">
                <TeamBadge
                  name={team.name}
                  color={team.color}
                  position={team.initialQueuePosition}
                  size="md"
                />
              </h3>
              <ul className="space-y-1 text-sm text-white/70">
                {team.players.length === 0 ? (
                  <li className="text-white/45">Sem jogadores registrados</li>
                ) : (
                  team.players.map((player) => (
                    <li key={player.memberId}>{playerLabel(player.name, player.nickname)}</li>
                  ))
                )}
              </ul>
            </article>
          ))}
        </div>
      </details>

      <details className="group rounded-2xl border border-white/10 bg-smv-navy-card open:pb-4">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-white marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            Estatísticas dos jogadores
            <span className="text-xs font-medium text-white/45 group-open:hidden">mostrar</span>
            <span className="hidden text-xs font-medium text-white/45 group-open:inline">ocultar</span>
          </span>
        </summary>
        <div className="px-4">
          {recap.playerStats.every(
            (row) =>
              row.totals.goals === 0 &&
              row.totals.assists === 0 &&
              row.totals.bigMisses === 0 &&
              row.totals.ownGoals === 0 &&
              row.totals.tackles === 0,
          ) ? (
            <div className={darkEmpty}>Nenhum evento individual registrado nesta sessão.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/45">
                  <tr>
                    <th className="px-3 py-2 font-medium">Jogador</th>
                    <th className="px-2 py-2 font-medium">G</th>
                    <th className="px-2 py-2 font-medium">A</th>
                    <th className="px-2 py-2 font-medium">Des</th>
                    <th className="px-2 py-2 font-medium">Pix</th>
                    <th className="px-2 py-2 font-medium">GC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {recap.playerStats
                    .filter(
                      (row) =>
                        row.totals.goals > 0 ||
                        row.totals.assists > 0 ||
                        row.totals.bigMisses > 0 ||
                        row.totals.ownGoals > 0 ||
                        row.totals.tackles > 0,
                    )
                    .map((row) => (
                      <tr key={row.memberId}>
                        <td className="px-3 py-2 font-medium text-white">
                          {playerLabel(row.name, row.nickname)}
                        </td>
                        <td className="px-2 py-2 text-white/70">{row.totals.goals}</td>
                        <td className="px-2 py-2 text-white/70">{row.totals.assists}</td>
                        <td className="px-2 py-2 text-white/70">{row.totals.tackles}</td>
                        <td className="px-2 py-2 text-white/70">{row.totals.bigMisses}</td>
                        <td className="px-2 py-2 text-white/70">{row.totals.ownGoals}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function ChampionCard({ recap }: { recap: RodadaRecap }) {
  const { champion } = recap;

  if (champion.kind === "determined") {
    const team = teamMeta(recap, champion.teamId);
    const standing = recap.standings.find((row) => row.teamId === champion.teamId);
    const showTiebreak = champion.decidedBy !== "wins";
    return (
      <section
        className="relative overflow-hidden rounded-3xl border border-smv-gold/40 p-5 shadow-lg shadow-smv-navy/30 ring-1 ring-smv-gold/25"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top right, rgba(201,162,39,0.28), transparent 55%), linear-gradient(145deg, #132a40 0%, #0b1c2c 48%, #061018 100%)",
        }}
      >
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: team?.color ?? "#c9a227" }}
          aria-hidden
        />
        <p className={darkSectionLabel}>Campeão da noite</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          <TeamBadge
            name={champion.teamName}
            color={team?.color ?? null}
            position={team?.initialQueuePosition}
            size="md"
            className="text-3xl"
          />
        </h2>
        {showTiebreak ? (
          <p className="mt-2 text-sm font-medium text-smv-gold-bright">{champion.reason}</p>
        ) : (
          <p className={`mt-2 text-sm ${darkMuted}`}>{champion.reason}</p>
        )}
        {standing && (
          <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              ["V", standing.wins],
              ["E", standing.draws],
              ["D", standing.losses],
              ["GP", standing.goalsFor],
              ["GC", standing.goalsAgainst],
              ["SG", formatSigned(standing.goalDifference)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl bg-black/25 px-2 py-2 text-center ring-1 ring-white/10"
              >
                <dt className="text-[10px] uppercase tracking-wide text-white/45">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-white">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {team && team.players.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/45">Elenco</p>
            <p className="mt-1 text-sm text-white/75">
              {team.players.map((player) => playerLabel(player.name, player.nickname)).join(" · ")}
            </p>
          </div>
        )}
      </section>
    );
  }

  if (champion.kind === "tied") {
    return (
      <section className="rounded-3xl border border-white/10 bg-smv-navy-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Campeão</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Empate na liderança</h2>
        <p className={`mt-2 text-sm ${darkMuted}`}>
          {champion.teamNames.join(", ")} empatados após vitórias, saldo, gols e confronto direto (
          {champion.wins} vitória{champion.wins === 1 ? "" : "s"} cada).
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {champion.teamIds.map((teamId, index) => {
            const team = teamMeta(recap, teamId);
            return (
              <li
                key={teamId}
                className="rounded-full bg-white/8 px-3 py-1 text-sm text-white ring-1 ring-white/10"
              >
                <TeamBadge
                  name={champion.teamNames[index] ?? teamId}
                  color={team?.color ?? null}
                  position={team?.initialQueuePosition}
                />
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-smv-navy-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Campeão</p>
      <h2 className="mt-1 text-2xl font-semibold text-white">Indeterminado</h2>
      <p className={`mt-2 text-sm ${darkMuted}`}>{champion.reason}</p>
    </section>
  );
}

function HighlightsGrid({ recap }: { recap: RodadaRecap }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-white">Destaques</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {recap.highlights.map((highlight) => (
          <article
            key={highlight.kind}
            className="rounded-2xl border border-white/10 bg-smv-navy-card p-4"
          >
            <p className={darkSectionLabel}>{highlight.label}</p>
            {highlight.value == null ? (
              <>
                <p className="mt-2 font-medium text-white/55">—</p>
                <p className={`mt-1 text-xs ${darkMuted}`}>Sem {highlight.metricLabel} nesta sessão</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-lg font-semibold text-white">
                  {highlight.leaders.length === 1
                    ? playerLabel(highlight.leaders[0]!.name, highlight.leaders[0]!.nickname)
                    : "Empate"}
                </p>
                {highlight.leaders.length > 1 && (
                  <p className="mt-1 text-sm text-white/70">
                    {highlight.leaders
                      .map((leader) => playerLabel(leader.name, leader.nickname))
                      .join(", ")}
                  </p>
                )}
                <p className="mt-1 text-sm tabular-nums text-smv-gold-bright">
                  {highlight.detail ?? `${highlight.value} ${highlight.metricLabel}`}
                </p>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function StandingsList({ recap }: { recap: RodadaRecap }) {
  const regular = recap.standings.filter((row) => {
    const team = teamMeta(recap, row.teamId);
    return team?.kind !== "ROTATION_POOL";
  });

  if (regular.every((row) => row.played === 0)) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">Classificação</h2>
        <div className={darkEmpty}>Sem confrontos para montar a tabela.</div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-white">Classificação</h2>
      <ol className="overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card divide-y divide-white/8">
        {regular.map((row) => {
          const team = teamMeta(recap, row.teamId);
          const isChampion =
            recap.champion.kind === "determined" && recap.champion.teamId === row.teamId;
          return (
            <li
              key={row.teamId}
              className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                isChampion ? "bg-smv-gold/10" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-10 shrink-0 text-sm font-semibold tabular-nums text-white/50">
                  {rankLabel(row.rank, row.rankTied)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">
                    <TeamBadge
                      name={row.name}
                      color={row.color}
                      position={team?.initialQueuePosition}
                      size="md"
                    />
                    {row.rankTied ? (
                      <span className="ml-2 text-xs font-medium text-white/45">empate</span>
                    ) : null}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-6 gap-2 text-center text-xs sm:flex sm:gap-3 sm:text-sm">
                {[
                  ["V", row.wins],
                  ["E", row.draws],
                  ["D", row.losses],
                  ["GP", row.goalsFor],
                  ["GC", row.goalsAgainst],
                  ["SG", formatSigned(row.goalDifference)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-8">
                    <dt className="text-white/40">{label}</dt>
                    <dd className="font-semibold tabular-nums text-white">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function HeadToHeadTable({ recap }: { recap: RodadaRecap }) {
  const { teamIds, cells } = recap.headToHead;
  if (teamIds.length < 2) {
    return <div className={darkEmpty}>Poucos times para montar a matriz.</div>;
  }
  const metaOf = (id: string) => teamMeta(recap, id);
  const cellAt = (rowId: string, colId: string) =>
    cells.find((cell) => cell.rowTeamId === rowId && cell.colTeamId === colId);

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <table className="min-w-full text-center text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-2 py-2 text-left text-white/45">vs</th>
            {teamIds.map((id) => {
              const team = metaOf(id);
              return (
                <th key={id} className="px-2 py-2 font-medium text-white/70">
                  <TeamBadge
                    name={team?.name ?? "—"}
                    color={team?.color ?? null}
                    position={team?.initialQueuePosition}
                    showLabel
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/8">
          {teamIds.map((rowId) => {
            const rowTeam = metaOf(rowId);
            return (
              <tr key={rowId}>
                <th className="px-2 py-2 text-left font-medium text-white">
                  <TeamBadge
                    name={rowTeam?.name ?? "—"}
                    color={rowTeam?.color ?? null}
                    position={rowTeam?.initialQueuePosition}
                  />
                </th>
                {teamIds.map((colId) => {
                  const cell = cellAt(rowId, colId);
                  if (rowId === colId) {
                    return (
                      <td key={colId} className="px-2 py-2 text-white/25">
                        —
                      </td>
                    );
                  }
                  if (!cell?.score) {
                    return (
                      <td key={colId} className="px-2 py-2 text-white/30">
                        ·
                      </td>
                    );
                  }
                  return (
                    <td key={colId} className="px-2 py-2 font-semibold text-smv-gold-bright">
                      {cell.score.for}–{cell.score.against}
                      {cell.score.penaltyWin ? " (p)" : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
