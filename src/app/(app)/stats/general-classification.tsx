import Link from "next/link";
import { formatWinPercentage, type GeneralClassificationBoard } from "@/server/modules/stats/queries";

function playerLabel(entry: GeneralClassificationBoard["entries"][number]): string {
  return entry.nickname ? `${entry.name} (${entry.nickname})` : entry.name;
}

export function GeneralClassificationTable({
  board,
  periodQuery,
}: {
  board: GeneralClassificationBoard;
  periodQuery: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-medium text-zinc-500">Classificação geral</h2>
        <p className="text-xs text-zinc-500">
          Aproveitamento = (V ÷ PJ) × 100 · só partidas de linha (sem goleiro) · empates de % compartilham
          posição
        </p>
      </div>
      {board.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
          Nenhum jogador neste período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Pos</th>
                <th className="px-3 py-2 font-medium">Jogador</th>
                <th className="px-2 py-2 text-right font-medium">PJ</th>
                <th className="px-2 py-2 text-right font-medium">V</th>
                <th className="px-2 py-2 text-right font-medium">E</th>
                <th className="px-2 py-2 text-right font-medium">D</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {board.entries.map((entry) => (
                <tr key={entry.memberId} className="active:bg-zinc-50">
                  <td className="px-3 py-2 tabular-nums text-zinc-500">
                    {entry.rank === null ? "—" : `${entry.rank}º`}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-zinc-900">
                    <Link
                      href={`/stats/players/${entry.memberId}${periodQuery ? `?${periodQuery}` : ""}`}
                      className="hover:underline"
                    >
                      {playerLabel(entry)}
                    </Link>
                    {entry.status === "INACTIVE" ? (
                      <span className="ml-1 text-xs font-normal text-zinc-400">inativo</span>
                    ) : null}
                    {entry.totals.matchesPlayed === 0 ? (
                      <span className="ml-1 text-xs font-normal text-zinc-400">sem PJ</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-zinc-900">
                    {entry.totals.matchesPlayed}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-700">{entry.totals.wins}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-700">{entry.totals.draws}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-700">{entry.totals.losses}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-800">
                    {formatWinPercentage(entry.winPercentage)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
