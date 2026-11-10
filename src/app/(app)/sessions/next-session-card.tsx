import Link from "next/link";
import type { Viewer } from "@/server/auth/dal";
import type { SessionBoard } from "@/server/modules/sessions/queries";
import { extraordinaryLabel, formatSessionTitle, formatTime, phaseDescription } from "./format";
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
      <div className="rounded-2xl border border-dashed border-white/20 bg-smv-navy-card px-4 py-6 text-center text-sm text-white/65">
        Nenhuma pelada agendada no momento.
      </div>
    );
  }

  const { session } = board;
  const timeZone = viewer.group.timezone;
  const free = Math.max(board.capacity - board.participants.length, 0);
  const kind = extraordinaryLabel(session.origin);
  const listLinkLabel =
    drawStatus === "VOTING" ? "Ver times e votar" : drawStatus ? "Ver lista e times" : "Ver lista completa";

  return (
    <article className="overflow-hidden rounded-3xl bg-smv-navy text-smv-cream shadow-lg shadow-smv-navy/20 ring-1 ring-white/10">
      <div
        className="relative flex flex-col gap-5 px-4 py-5 sm:px-5 sm:py-6"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top right, rgba(201,162,39,0.18), transparent 55%), linear-gradient(145deg, #132a40 0%, #0b1c2c 48%, #061018 100%)",
        }}
      >
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-smv-gold">
            {kind ? "Próximo treino" : "Próxima pelada"}
          </p>
          <h2 className="mt-1 text-xl font-semibold capitalize leading-snug text-white sm:text-2xl">
            {formatSessionTitle(session.startsAt, timeZone)}
          </h2>
          <p className="mt-1 text-sm text-white/75">
            {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)}
            {session.venueName ? ` · ${session.venueName}` : ""}
            {kind ? ` · ${kind}` : ""}
          </p>
        </div>

        <p className="rounded-xl bg-white/8 px-3 py-2.5 text-sm text-white/85 ring-1 ring-white/10">
          {phaseDescription(board.phase, session, timeZone)}
        </p>

        {board.phase !== "CANCELLED" && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Confirmados" value={`${board.participants.length}/${board.capacity}`} />
            <Stat label="Vagas" value={String(free)} />
            <Stat label="Espera" value={String(board.waitlist.length)} />
          </div>
        )}

        {board.phase !== "CANCELLED" && board.phase !== "CLOSED" && (
          <div className="rounded-2xl bg-black/25 p-3 ring-1 ring-white/10">
            <MySessionStatus board={board} viewer={viewer} />
          </div>
        )}

        {drawStatus && board.phase !== "CANCELLED" && (
          <p className="rounded-xl bg-smv-gold/15 px-3 py-2 text-sm text-smv-cream ring-1 ring-smv-gold/30">
            {DRAW_STATUS_TEXT[drawStatus]}
          </p>
        )}

        <Link
          href={`/sessions/${session.id}`}
          className="flex min-h-12 items-center justify-center rounded-xl border border-smv-gold/50 bg-smv-gold/10 px-4 text-sm font-semibold text-smv-gold-bright transition-colors active:bg-smv-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
        >
          {listLinkLabel}
        </Link>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/8 px-2 py-2.5 ring-1 ring-white/10">
      <p className="text-lg font-semibold tabular-nums text-white">{value}</p>
      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-white/55">{label}</p>
    </div>
  );
}
