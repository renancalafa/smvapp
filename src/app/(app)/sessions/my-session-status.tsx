import type { Viewer } from "@/server/auth/dal";
import { ATTENDANCE_LOCKED_MESSAGE } from "@/server/modules/sessions/engine";
import type { SessionBoard } from "@/server/modules/sessions/queries";
import { RespondButtons } from "./respond-buttons";

/** Situação do jogador na sessão e os botões de resposta, conforme a fase da lista. */
export function MySessionStatus({ board, viewer }: { board: SessionBoard; viewer: Viewer }) {
  const all = [...board.participants, ...board.waitlist, ...board.declined, ...board.withdrawn, ...board.removed];
  const mine = all.find((registration) => registration.memberId === viewer.member.id) ?? null;
  const waitPosition = board.waitlist.findIndex((registration) => registration.memberId === viewer.member.id) + 1;
  const isMonthly = viewer.member.modality === "MONTHLY";
  const open = board.phase === "PRIORITY" || board.phase === "GENERAL";
  const locked = board.attendanceLocked;
  // Sorteio antecipado: até o prazo, o mensalista ainda entra na lista de espera.
  const lateMonthlyWaitlist =
    locked &&
    board.phase === "PRIORITY" &&
    isMonthly &&
    mine?.status !== "PARTICIPANT" &&
    mine?.status !== "WAITLISTED" &&
    mine?.status !== "REMOVED";

  let text: string;
  switch (mine?.status) {
    case "PARTICIPANT":
      text = mine.promotedAt ? "Você está confirmado (entrou pela lista de espera)." : "Você está confirmado.";
      break;
    case "WAITLISTED":
      text = `Você está na lista de espera, posição ${waitPosition}.`;
      if (board.phase === "PRIORITY" && mine.priorityTier === "GENERAL") {
        text += " Diaristas entram depois do prazo dos mensalistas, se houver vaga.";
      }
      break;
    case "DECLINED":
      text = "Você avisou que não vai.";
      break;
    case "WITHDRAWN":
      text = "Você saiu da lista.";
      break;
    case "REMOVED":
      text = "Você foi removido desta sessão por um administrador.";
      break;
    default:
      text = locked ? "Você não está na lista." : isMonthly ? "Você ainda não respondeu." : "Quer jogar? Entre na fila.";
  }
  if (!mine && isMonthly && board.phase === "GENERAL" && !locked) {
    text += " O prazo dos mensalistas passou: se confirmar agora, você entra no fim da fila.";
  }

  if (viewer.member.status !== "ACTIVE") {
    return <p className="text-sm text-zinc-500">Jogadores inativos não participam das sessões. Fale com um administrador.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-zinc-900">{text}</p>
      {open && locked && !lateMonthlyWaitlist && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{ATTENDANCE_LOCKED_MESSAGE}</p>
      )}
      {open && lateMonthlyWaitlist && (
        <>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Sorteio antecipado: a sessão está cheia e os times já foram sorteados. Até o prazo dos mensalistas, você
            ainda pode entrar na lista de espera, à frente dos diaristas.
          </p>
          <RespondButtons
            sessionId={board.session.id}
            myStatus={mine?.status ?? null}
            canDecline={false}
            confirmLabel="Entrar na lista de espera"
          />
        </>
      )}
      {open && !locked && mine?.status !== "REMOVED" && (
        <RespondButtons sessionId={board.session.id} myStatus={mine?.status ?? null} canDecline={!mine} />
      )}
    </div>
  );
}
