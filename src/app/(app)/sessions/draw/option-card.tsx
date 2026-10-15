import type { DrawOptionView } from "@/server/modules/draws/queries";

/** Uma opção do sorteio: times e jogadores. Força só aparece quando a view a traz (ADMIN). */
export function OptionCard({
  option,
  official,
  mine,
  footer,
}: {
  option: DrawOptionView;
  official: boolean;
  mine: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 ${official ? "border-emerald-500 ring-2 ring-emerald-500/20" : "border-zinc-200"}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-zinc-900">Opção {option.label}</h3>
        {official && <Badge tone="emerald">Oficial</Badge>}
        {mine && <Badge tone="zinc">Seu voto</Badge>}
        <span className="ml-auto text-sm tabular-nums text-zinc-600">
          {option.votes} {option.votes === 1 ? "voto" : "votos"}
        </span>
      </header>
      {option.balanceScore !== null && (
        <p className="text-xs text-zinc-500">Diferença entre o time mais forte e o mais fraco: {option.balanceScore}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {option.teams.map((team) => (
          <section
            key={team.id}
            className={`rounded-xl px-3 py-2 ${team.kind === "ROTATION_POOL" ? "col-span-2 bg-amber-50" : "bg-zinc-50"}`}
          >
            <h4 className="flex items-baseline justify-between text-sm font-medium text-zinc-900">
              {team.name}
              {team.strengthTotal !== null && <span className="text-xs tabular-nums text-zinc-500">{team.strengthTotal}</span>}
            </h4>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-zinc-700">
              {team.players.map((player) => (
                <li key={player.memberId} className="flex justify-between gap-2">
                  <span className="truncate">{player.name}</span>
                  {player.strength !== null && <span className="shrink-0 tabular-nums text-zinc-400">{player.strength}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {option.voterNames && option.voterNames.length > 0 && (
        <p className="text-xs text-zinc-500">Votaram: {option.voterNames.join(", ")}</p>
      )}
      {footer}
    </article>
  );
}

function Badge({ tone, children }: { tone: "emerald" | "zinc"; children: React.ReactNode }) {
  const colors = tone === "emerald" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>{children}</span>;
}
