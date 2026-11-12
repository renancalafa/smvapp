import { darkAlertWarn, darkMuted } from "@/lib/ui/dark-surfaces";
import type { Viewer } from "@/server/auth/dal";
import { ATTENDANCE_LOCKED_MESSAGE } from "@/server/modules/sessions/engine";
import type { SessionBoard } from "@/server/modules/sessions/queries";
import { RespondButtons } from "./respond-buttons";

/** Situação do jogador na sessão e os botões de resposta, conforme a fase da lista. */
export function MySessionStatus({
  board,
  viewer,
}: {
  board: SessionBoard;
  viewer: Viewer;
}) {
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
  const removed = mine?.status === "REMOVED";
  const confirmEnabled = open && !removed && (!locked || lateMonthlyWaitlist);
  const declineEnabled = open && !removed && !locked;
  const disabledReason = !open
    ? board.phase === "SCHEDULED"
      ? "A lista desta sessão ainda não abriu."
      : board.phase === "CANCELLED"
        ? "Esta sessão foi cancelada."
        : "A lista desta sessão já fechou."
    : lateMonthlyWaitlist
      ? "Com o sorteio antecipado, só é possível entrar na lista de espera. “Não vou” fica bloqueado até a lista liberar."
      : null;

  let text: string;
  switch (mine?.status) {
    case "PARTICIPANT":
      text = mine.promotedAt ? "Você está confirmado (entrou pela lista de espera)." : "Você está confirmado.";
      break;
    case "WAITLISTED":
      text = `Você está na lista de espera, posição ${waitPosition}.`;
      if (board.phase === "PRIORITY" && mine.priorityTier === "MONTHLY_PRIORITY") {
        text +=
          board.participants.length >= board.capacity
            ? " A lista está cheia: se não houver diarista deslocável, um administrador precisa liberar a vaga."
            : " Com prioridade, você entra na próxima vaga livre antes dos diaristas.";
      } else if (board.phase === "PRIORITY" && mine.priorityTier === "GENERAL") {
        text +=
          " Antes do prazo, diaristas só sobem se um mensalista liberar a vaga com “Não vou” (na ordem da fila). Vagas vazias sem essa liberação ficam reservadas aos mensalistas até o prazo — depois disso, a espera sobe em FIFO.";
      } else if (board.phase === "GENERAL" && board.attendanceLocked) {
        text +=
          " Com o sorteio/votação ativos, vagas livres não preenchem sozinhas: um administrador precisa promover alguém da espera.";
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
    return <p className={darkMuted}>Jogadores inativos não participam das sessões. Fale com um administrador.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-white">{text}</p>
      {open && locked && !lateMonthlyWaitlist && <p className={darkAlertWarn}>{ATTENDANCE_LOCKED_MESSAGE}</p>}
      {open && lateMonthlyWaitlist && (
        <p className={darkAlertWarn}>
          Sorteio antecipado: a sessão está cheia e os times já foram sorteados. Até o prazo dos mensalistas, você ainda
          pode entrar na lista de espera, à frente dos diaristas.
        </p>
      )}
      {!removed && (
        <RespondButtons
          sessionId={board.session.id}
          myStatus={mine?.status ?? null}
          confirmEnabled={confirmEnabled}
          declineEnabled={declineEnabled}
          confirmLabel={lateMonthlyWaitlist ? "Entrar na lista de espera" : "Vou jogar"}
          disabledReason={disabledReason}
        />
      )}
    </div>
  );
}
