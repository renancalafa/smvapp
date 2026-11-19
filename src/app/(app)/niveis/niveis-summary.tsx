import { darkMutedXs, darkStat } from "@/lib/ui/dark-surfaces";

function SummaryCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent: string;
  hint?: string;
}) {
  return (
    <div className={`${darkStat} flex min-h-[4.5rem] flex-col justify-center gap-0.5 px-3 py-2.5 text-left`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${accent}`}>{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-smv-cream">{value}</p>
      {hint ? <p className={darkMutedXs}>{hint}</p> : null}
    </div>
  );
}

export function NiveisSummary({
  openVoting,
  pendingReview,
  awaitingFinal,
  history,
}: {
  openVoting: number;
  pendingReview: number;
  awaitingFinal: number;
  history: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <SummaryCard label="Em votação" value={openVoting} accent="text-smv-gold-bright" />
      <SummaryCard label="Aguardando Admin" value={pendingReview} accent="text-amber-100" />
      <SummaryCard label="Decisão final" value={awaitingFinal} accent="text-sky-100" />
      <SummaryCard label="Histórico" value={history} accent="text-white/55" hint="finalizadas" />
    </div>
  );
}
