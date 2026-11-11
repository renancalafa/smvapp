import { darkMuted, darkSectionLabel } from "@/lib/ui/dark-surfaces";
import type { HomePlayerSummary } from "@/server/modules/home/queries";
import { MODALITY_LABEL } from "./labels";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

function displayName(player: HomePlayerSummary): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

export function HomePlayerSummaryCard({ player }: { player: HomePlayerSummary }) {
  const stats = [
    { label: "Presenças", value: player.presencas },
    { label: "Gols", value: player.goals },
    { label: "Assist.", value: player.assists },
  ] as const;

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/10 p-4 shadow-sm ring-1 ring-white/5 sm:p-5"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at top left, rgba(201,162,39,0.16), transparent 50%), linear-gradient(145deg, #132a40 0%, #0b1c2c 55%, #061018 100%)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-smv-gold/20 text-sm font-bold text-smv-gold-bright ring-1 ring-smv-gold/35"
          aria-hidden
        >
          {initials(player.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className={darkSectionLabel}>Seu resumo</p>
          <h2 className="truncate text-xl font-semibold tracking-tight text-white">
            {displayName(player)}
          </h2>
          <p className={`mt-0.5 ${darkMuted}`}>{MODALITY_LABEL[player.modality]}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl bg-black/25 px-2 py-2.5 text-center ring-1 ring-white/10"
          >
            <dt className="text-[10px] font-medium uppercase tracking-wide text-white/45">
              {stat.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-white">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
