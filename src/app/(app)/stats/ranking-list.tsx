import Link from "next/link";
import { RANKING_METRIC_LABELS, type RankingBoard } from "@/server/modules/stats/queries";

function playerLabel(entry: RankingBoard["entries"][number]): string {
  return entry.nickname ? `${entry.name} (${entry.nickname})` : entry.name;
}

export function RankingList({
  board,
  periodQuery,
}: {
  board: RankingBoard;
  periodQuery: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-500">{RANKING_METRIC_LABELS[board.metric]}</h2>
      {board.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
          Nenhum registro neste período.
        </p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {board.entries.map((entry) => (
            <li key={entry.memberId}>
              <Link
                href={`/stats/players/${entry.memberId}${periodQuery ? `?${periodQuery}` : ""}`}
                className="flex min-h-12 items-center gap-3 px-4 py-2 active:bg-zinc-50"
              >
                <span className="w-8 shrink-0 text-sm font-semibold tabular-nums text-zinc-500">{entry.rank}º</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                  {playerLabel(entry)}
                  {entry.status === "INACTIVE" ? (
                    <span className="ml-1 text-xs font-normal text-zinc-400">inativo</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-emerald-800">{entry.value}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
