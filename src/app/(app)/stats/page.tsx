import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/server/auth/dal";
import {
  getAllRankingBoards,
  getGeneralClassification,
  getStatsFilterOptions,
  parseStatsPeriodFromSearchParams,
  periodToSearchParams,
} from "@/server/modules/stats/queries";
import { GeneralClassificationTable } from "./general-classification";
import { PeriodFilter } from "./period-filter";
import { RankingList } from "./ranking-list";

export const metadata: Metadata = { title: "Rankings" };
export const dynamic = "force-dynamic";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const period = parseStatsPeriodFromSearchParams(params);
  const timeZone = viewer.group.timezone;
  const [options, boards, classification] = await Promise.all([
    getStatsFilterOptions(viewer.group.id, timeZone),
    getAllRankingBoards(viewer.group.id, timeZone, period),
    getGeneralClassification(viewer.group.id, timeZone, period),
  ]);
  const periodQuery = new URLSearchParams(periodToSearchParams(period)).toString();
  const hasAny =
    classification.entries.length > 0 || boards.some((board) => board.entries.length > 0);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Rankings</h1>
        <p className="text-sm text-zinc-600">
          Classificação por aproveitamento e estatísticas individuais a partir das partidas.
        </p>
      </div>

      <PeriodFilter action="/stats" period={period} options={options} timeZone={timeZone} />

      {!hasAny ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
          <p className="font-medium text-zinc-800">Nenhuma estatística neste período</p>
          <p className="mt-1 text-sm text-zinc-600">
            Os rankings aparecem depois que houver partidas finalizadas com eventos registrados no Modo
            Pelada.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <GeneralClassificationTable board={classification} periodQuery={periodQuery} />
          {boards.map((board) => (
            <RankingList key={board.metric} board={board} periodQuery={periodQuery} />
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-500">
        PJ / V / E / D consideram apenas papel de linha (`FIELD`). Eventos de goleiro continuam nos
        placares de gols, cartões etc.{" "}
        <Link href={`/stats/players/${viewer.member.id}${periodQuery ? `?${periodQuery}` : ""}`} className="underline">
          Meu perfil
        </Link>
      </p>
    </section>
  );
}
