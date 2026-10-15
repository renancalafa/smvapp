import Link from "next/link";
import type { Viewer } from "@/server/auth/dal";
import type { SessionBoard } from "@/server/modules/sessions/queries";
import { formatSessionTitle, formatTime, phaseDescription } from "./format";
import { MySessionStatus } from "./my-session-status";

const DRAW_STATUS_TEXT = {
  VOTING: "Sorteio feito: votação dos times aberta.",
  TIED: "Votação dos times empatada: os administradores vão decidir.",
  DECIDED: "Times definidos.",
  INVALIDATED: "Sorteio invalidado.",
} as const;

export function NextSessionCard({
  board,
  viewer,
  drawStatus,
}: {
  board: SessionBoard | null;
  viewer: Viewer;
  drawStatus: keyof typeof DRAW_STATUS_TEXT | null;
}) {
  if (!board) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Nenhuma pelada agendada no momento.
      </div>
    );
  }
  const { session } = board;
  const timeZone = viewer.group.timezone;
  const free = Math.max(board.capacity - board.participants.length, 0);

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Próxima pelada</p>
        <h2 className="mt-1 text-xl font-semibold capitalize text-zinc-900">{formatSessionTitle(session.startsAt, timeZone)}</h2>
        <p className="text-sm text-zinc-600">
          {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)}
          {session.venueName ? ` · ${session.venueName}` : ""}
        </p>
        <p className="mt-2 text-sm text-zinc-600">{phaseDescription(board.phase, session, timeZone)}</p>
      </div>

      {board.phase !== "CANCELLED" && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Confirmados" value={`${board.participants.length}/${board.capacity}`} />
          <Stat label="Vagas" value={String(free)} />
          <Stat label="Espera" value={String(board.waitlist.length)} />
        </div>
      )}

      {board.phase !== "CANCELLED" && board.phase !== "CLOSED" && <MySessionStatus board={board} viewer={viewer} />}

      {drawStatus && board.phase !== "CANCELLED" && (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{DRAW_STATUS_TEXT[drawStatus]}</p>
      )}

      <Link
        href={`/sessions/${session.id}`}
        className="flex min-h-11 items-center justify-center rounded-lg text-sm font-medium text-emerald-800 active:bg-emerald-50"
      >
        {drawStatus === "VOTING" ? "Ver times e votar" : drawStatus ? "Ver lista e times" : "Ver lista completa"}
      </Link>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2 py-2">
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
