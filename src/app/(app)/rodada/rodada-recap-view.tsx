import {
  darkCardPad,
  darkEmpty,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import type { RodadaRecap } from "@/server/modules/rodada/queries";
import { extraordinaryLabel, formatSessionTitle, formatTime } from "../sessions/format";

function playerLabel(name: string, nickname: string | null): string {
  return nickname ? `${name} (${nickname})` : name;
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-smv-gold">Rodada</p>
          <h1 className={darkTitle}>Última pelada</h1>
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
  const teamName = (id: string) => recap.teams.find((team) => team.id === id)?.name ?? "—";

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <header
        className="relative overflow-hidden rounded-3xl bg-smv-navy p-5 shadow-lg shadow-smv-navy/25 ring-1 ring-white/10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top right, rgba(201,162,39,0.22), transparent 55%), linear-gradient(145deg, #132a40 0%, #0b1c2c 48%, #061018 100%)",
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-smv-gold">
          Rodada
          {extra ? ` · ${extra}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          {formatSessionTitle(startsAt, timeZone)}
        </h1>
        <p className={`mt-1 ${darkMuted}`}>
          {formatTime(startsAt, timeZone)} – {formatTime(endsAt, timeZone)}
          {recap.venueName ? ` · ${recap.venueName}` : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-smv-gold/15 px-3 py-1 text-sm font-medium text-smv-gold-bright ring-1 ring-smv-gold/30">
            {recap.playerCount} jogadores
          </span>
          <span className="rounded-full bg-white/8 px-3 py-1 text-sm text-white/70 ring-1 ring-white/10">
            {recap.matches.length} partida{recap.matches.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {recap.incompleteNote && (
        <p className="rounded-xl border border-dashed border-smv-gold/35 bg-smv-gold/10 px-4 py-3 text-sm text-smv-gold-bright">
          {recap.incompleteNote}
        </p>
      )}

      <ChampionCard champion={recap.champion} />

      <Section title="Times">
        <div className="grid gap-3 sm:grid-cols-2">
          {recap.teams.map((team) => (
            <article key={team.id} className={darkCardPad}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full ring-1 ring-white/20"
                  style={{ backgroundColor: team.color ?? "#c9a227" }}
                  aria-hidden
                />
                <h3 className="font-semibold text-white">{team.name}</h3>
              </div>
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
      </Section>

      <Section title="Resultados">
        {recap.matches.length === 0 ? (
          <div className={darkEmpty}>Nenhuma partida finalizada nesta sessão.</div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card divide-y divide-white/8">
            {recap.matches.map((match) => (
              <li key={match.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-8 shrink-0 text-xs font-semibold text-white/40">#{match.sequence}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {match.teamAName}{" "}
                    <span className="text-smv-gold-bright">
                      {match.scoreA}–{match.scoreB}
                    </span>{" "}
                    {match.teamBName}
                  </p>
                  {match.penaltyWinnerTeamId && (
                    <p className="text-xs text-white/45">
                      Pênaltis: {teamName(match.penaltyWinnerTeamId)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Classificação">
        {recap.standings.every((row) => row.played === 0) ? (
          <div className={darkEmpty}>Sem confrontos para montar a tabela.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-smv-navy-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/45">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">J</th>
                  <th className="px-2 py-2 font-medium">V</th>
                  <th className="px-2 py-2 font-medium">E</th>
                  <th className="px-2 py-2 font-medium">D</th>
                  <th className="px-2 py-2 font-medium">GP</th>
                  <th className="px-2 py-2 font-medium">GC</th>
                  <th className="px-2 py-2 font-medium">SG</th>
                  <th className="px-2 py-2 font-medium">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {recap.standings.map((row) => (
                  <tr key={row.teamId}>
                    <td className="px-3 py-2 font-medium text-white">{row.name}</td>
                    <td className="px-2 py-2 text-white/70">{row.played}</td>
                    <td className="px-2 py-2 text-white/70">{row.wins}</td>
                    <td className="px-2 py-2 text-white/70">{row.draws}</td>
                    <td className="px-2 py-2 text-white/70">{row.losses}</td>
                    <td className="px-2 py-2 text-white/70">{row.goalsFor}</td>
                    <td className="px-2 py-2 text-white/70">{row.goalsAgainst}</td>
                    <td className="px-2 py-2 text-white/70">{row.goalDifference}</td>
                    <td className="px-2 py-2 font-semibold text-smv-gold-bright">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Confrontos diretos">
        <p className={`-mt-1 text-sm ${darkMuted}`}>
          Cada célula mostra o placar do confronto mais recente entre o time da linha e o da
          coluna (partida finalizada de maior sequência). Sem jogo entre o par: ponto.
        </p>
        <HeadToHeadTable recap={recap} />
      </Section>

      <Section title="Estatísticas dos jogadores">
        {recap.playerStats.every(
          (row) =>
            row.totals.goals === 0 &&
            row.totals.assists === 0 &&
            row.totals.bigMisses === 0 &&
            row.totals.ownGoals === 0,
        ) ? (
          <div className={darkEmpty}>Nenhum evento individual registrado nesta sessão.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-smv-navy-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/45">
                <tr>
                  <th className="px-3 py-2 font-medium">Jogador</th>
                  <th className="px-2 py-2 font-medium">G</th>
                  <th className="px-2 py-2 font-medium">A</th>
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
                      row.totals.ownGoals > 0,
                  )
                  .map((row) => (
                    <tr key={row.memberId}>
                      <td className="px-3 py-2 font-medium text-white">
                        {playerLabel(row.name, row.nickname)}
                      </td>
                      <td className="px-2 py-2 text-white/70">{row.totals.goals}</td>
                      <td className="px-2 py-2 text-white/70">{row.totals.assists}</td>
                      <td className="px-2 py-2 text-white/70">{row.totals.bigMisses}</td>
                      <td className="px-2 py-2 text-white/70">{row.totals.ownGoals}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function ChampionCard({ champion }: { champion: RodadaRecap["champion"] }) {
  if (champion.kind === "determined") {
    return (
      <div className="rounded-2xl border border-smv-gold/35 bg-gradient-to-br from-smv-gold/20 to-transparent px-4 py-4 ring-1 ring-smv-gold/25">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-smv-gold">Campeão da noite</p>
        <p className="mt-1 text-xl font-semibold text-white">{champion.teamName}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-smv-navy-card px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Campeão</p>
      <p className="mt-1 font-medium text-white">Indeterminado</p>
      <p className={`mt-1 text-sm ${darkMuted}`}>{champion.reason}</p>
    </div>
  );
}

function HeadToHeadTable({ recap }: { recap: RodadaRecap }) {
  const { teamIds, cells } = recap.headToHead;
  if (teamIds.length < 2) {
    return <div className={darkEmpty}>Poucos times para montar a matriz.</div>;
  }
  const nameOf = (id: string) => recap.teams.find((team) => team.id === id)?.name ?? "—";
  const cellAt = (rowId: string, colId: string) =>
    cells.find((cell) => cell.rowTeamId === rowId && cell.colTeamId === colId);

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-smv-navy-card">
      <table className="min-w-full text-center text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-2 py-2 text-left text-white/45">vs</th>
            {teamIds.map((id) => (
              <th key={id} className="px-2 py-2 font-medium text-white/70">
                {nameOf(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/8">
          {teamIds.map((rowId) => (
            <tr key={rowId}>
              <th className="px-2 py-2 text-left font-medium text-white">{nameOf(rowId)}</th>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
