import { TeamBadge } from "@/components/team-badge";
import { darkBadge, darkBadgeGold, darkCard } from "@/lib/ui/dark-surfaces";
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
      className={`flex flex-col gap-3 p-4 ${darkCard} ${
        official ? "ring-2 ring-smv-gold/40 border-smv-gold/40" : ""
      } ${mine && !official ? "ring-1 ring-white/25" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-white">Opção {option.label}</h3>
        {official && <Badge emphasis>Oficial</Badge>}
        {mine && <Badge>Seu voto</Badge>}
        <span className="ml-auto text-sm tabular-nums text-white/60">
          {option.votes} {option.votes === 1 ? "voto" : "votos"}
        </span>
      </header>
      {option.balanceScore !== null && (
        <p className="text-xs text-white/50">
          Diferença entre o time mais forte e o mais fraco: {option.balanceScore}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {option.teams.map((team) => (
          <section
            key={team.id}
            className={`rounded-xl px-3 py-2 ${
              team.kind === "ROTATION_POOL"
                ? "col-span-2 bg-amber-400/10 ring-1 ring-amber-300/25"
                : "bg-black/25 ring-1 ring-white/10"
            }`}
          >
            <h4 className="flex items-baseline justify-between text-sm font-medium text-white">
              <TeamBadge
                name={team.name}
                color={team.color}
                position={team.kind === "ROTATION_POOL" ? null : team.position}
              />
              {team.strengthTotal !== null && (
                <span className="text-xs tabular-nums text-white/50">{team.strengthTotal}</span>
              )}
            </h4>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-white/75">
              {team.players.map((player) => (
                <li key={player.memberId} className="flex justify-between gap-2">
                  <span className="truncate">{player.name}</span>
                  {player.strength !== null && (
                    <span className="shrink-0 tabular-nums text-white/40">{player.strength}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {option.voterNames && option.voterNames.length > 0 && (
        <p className="text-xs text-white/50">Votaram: {option.voterNames.join(", ")}</p>
      )}
      {footer}
    </article>
  );
}

function Badge({ emphasis, children }: { emphasis?: boolean; children: React.ReactNode }) {
  return <span className={emphasis ? darkBadgeGold : darkBadge}>{children}</span>;
}
