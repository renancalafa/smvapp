import Link from "next/link";
import {
  darkEmpty,
  darkList,
  darkListRow,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
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
      <h2 className={darkSectionLabel}>{RANKING_METRIC_LABELS[board.metric]}</h2>
      {board.entries.length === 0 ? (
        <p className={darkEmpty}>Nenhum registro neste período.</p>
      ) : (
        <ol className={darkList}>
          {board.entries.map((entry) => (
            <li key={entry.memberId}>
              <Link
                href={`/stats/players/${entry.memberId}${periodQuery ? `?${periodQuery}` : ""}`}
                className={darkListRow}
              >
                <span className="w-8 shrink-0 text-sm font-semibold tabular-nums text-white/50">
                  {entry.rank}º
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-smv-cream">
                  {playerLabel(entry)}
                  {entry.status === "INACTIVE" ? (
                    <span className="ml-1 text-xs font-normal text-white/40">inativo</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-smv-gold-bright">
                  {entry.value}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
