import Link from "next/link";
import {
  darkEmpty,
  darkMutedXs,
  darkSectionLabel,
  darkTableCell,
  darkTableHead,
  darkTableWrap,
} from "@/lib/ui/dark-surfaces";
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
        <h2 className={darkSectionLabel}>Classificação geral</h2>
        <p className={darkMutedXs}>
          Aproveitamento = (V ÷ PJ) × 100 · só partidas de linha (sem goleiro) · empates de % compartilham
          posição
        </p>
      </div>
      {board.entries.length === 0 ? (
        <p className={darkEmpty}>Nenhum jogador neste período.</p>
      ) : (
        <div className={darkTableWrap}>
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className={darkTableHead}>
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
            <tbody className="divide-y divide-white/8">
              {board.entries.map((entry) => (
                <tr key={entry.memberId} className="active:bg-white/5">
                  <td className={`${darkTableCell} tabular-nums text-white/50`}>
                    {entry.rank === null ? "—" : `${entry.rank}º`}
                  </td>
                  <td className={`${darkTableCell} max-w-[10rem] truncate font-medium text-smv-cream`}>
                    <Link
                      href={`/stats/players/${entry.memberId}${periodQuery ? `?${periodQuery}` : ""}`}
                      className="hover:underline"
                    >
                      {playerLabel(entry)}
                    </Link>
                    {entry.status === "INACTIVE" ? (
                      <span className="ml-1 text-xs font-normal text-white/40">inativo</span>
                    ) : null}
                    {entry.totals.matchesPlayed === 0 ? (
                      <span className="ml-1 text-xs font-normal text-white/40">sem PJ</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">
                    {entry.totals.matchesPlayed}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/75">{entry.totals.wins}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/75">{entry.totals.draws}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/75">{entry.totals.losses}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-smv-gold-bright">
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
