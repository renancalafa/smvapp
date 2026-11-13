import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  darkAlertWarn,
  darkBody,
  darkCardPad,
  darkEmptyCompact,
  darkLinkCard,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSectionLabel, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getLiveBoard } from "@/server/modules/matches/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionScoutBoard } from "@/server/modules/scouts/queries";
import { getAdminRoster, getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import {
  displayName,
  extraordinaryLabel,
  formatDateTime,
  formatSessionTitle,
  formatTime,
  phaseDescription,
} from "../../../sessions/format";
import { RegistrationList } from "../../../sessions/registration-list";
import { CancelExtraordinaryForm } from "./cancel-extraordinary-form";
import { ConfirmOnBehalfForm } from "./confirm-on-behalf-form";
import { DevTestTools } from "./dev-tools";
import { IncludeForm } from "./include-form";
import { EndSessionForm } from "./live/end-session-form";
import { RegistrationActions } from "./registration-actions";
import { SessionScoutsPanel } from "./session-scouts-panel";

export const metadata: Metadata = { title: "Sessão" };

export default async function AdminSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await requireAdmin();
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  await syncSessionsForRead(viewer.group.id);
  const now = new Date();
  const board = await getSessionBoard(viewer.group.id, sessionId, now);
  if (!board) notFound();
  const [roster, live, scoutBoard] = await Promise.all([
    getAdminRoster(viewer.group.id, board),
    getLiveBoard(viewer.group.id, sessionId, now),
    getSessionScoutBoard(viewer.group.id, sessionId),
  ]);

  const { session } = board;
  const timeZone = viewer.group.timezone;
  const kind = extraordinaryLabel(session.origin);
  const canChangeList =
    board.phase !== "CANCELLED" && board.phase !== "CLOSED" && !live?.participantsFrozen;
  const canMarkAttendance = board.phase !== "CANCELLED" && now >= session.startsAt;
  const canCancelExtraordinary =
    session.origin === "EXTRAORDINARY" &&
    board.phase !== "CANCELLED" &&
    board.phase !== "CLOSED" &&
    !live?.participantsFrozen;
  const hasFreeSpot = board.participants.length < board.capacity;
  const earlyDrawWaitlist = board.attendanceLocked && board.phase === "PRIORITY";
  const confirmable = earlyDrawWaitlist
    ? roster.confirmable.filter((member) => member.modality === "MONTHLY")
    : roster.confirmable;
  const confirmedActions = (registration: (typeof board.participants)[number]) => (
    <RegistrationActions
      sessionId={session.id}
      registrationId={registration.id}
      status={registration.status}
      attendance={registration.attendance}
      canChangeList={canChangeList}
      canMarkAttendance={canMarkAttendance}
      hasFreeSpot={hasFreeSpot}
      compact
    />
  );
  const waitlistActions = (registration: (typeof board.participants)[number]) => (
    <RegistrationActions
      sessionId={session.id}
      registrationId={registration.id}
      status={registration.status}
      attendance={registration.attendance}
      canChangeList={canChangeList}
      canMarkAttendance={canMarkAttendance}
      hasFreeSpot={hasFreeSpot}
      compact
    />
  );
  const presentCount = board.participants.filter((registration) => registration.attendance === "PRESENT").length;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin/sessions" className={shellBackLink}>
          ‹ Sessões
        </Link>
        <h1 className={`capitalize ${darkTitle}`}>{formatSessionTitle(session.startsAt, timeZone)}</h1>
        <p className={shellSubtext}>
          {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)}
          {session.venueName ? ` · ${session.venueName}` : ""}
          {kind ? ` · ${kind}` : ""}
          {" · "}lista abre {formatDateTime(session.registrationOpensAt, timeZone)} · prazo dos mensalistas{" "}
          {formatDateTime(session.priorityDeadlineAt, timeZone)}
        </p>
        <p className={`mt-1 ${shellSubtext}`}>{phaseDescription(board.phase, session, timeZone)}</p>
        {live?.participantsFrozen && (
          <p className={`mt-2 ${darkAlertWarn}`}>
            Partidas iniciadas: a lista de presença está congelada para todos. Quem não puder jogar fica indisponível
            (empréstimo por partida — em breve neste modo).
          </p>
        )}
        {canChangeList && board.attendanceLocked && (
          <p className={`mt-2 ${darkAlertWarn}`}>
            Votação/sorteio ativo: os jogadores não alteram mais a lista e a fila{" "}
            <strong className="font-semibold text-amber-50">não promove automaticamente</strong>
            {board.participants.length < board.capacity && board.waitlist.length > 0
              ? ` — há ${board.capacity - board.participants.length} vaga(s) livre(s) com ${board.waitlist.length} na espera: use “Promover…”`
              : ". Use “Promover…” na lista de espera para preencher uma vaga"}
            .
          </p>
        )}
        {canChangeList &&
          !board.attendanceLocked &&
          board.phase === "PRIORITY" &&
          board.participants.length < board.capacity &&
          board.waitlist.some((row) => (row.priorityTier ?? "GENERAL") === "GENERAL") &&
          (() => {
            const monthlyAbsences = [...board.declined, ...board.withdrawn].filter(
              (row) => row.modalitySnapshot === "MONTHLY",
            ).length;
            const dailySeated = board.participants.filter(
              (row) => (row.priorityTier ?? "GENERAL") === "GENERAL" && !row.manualOverrideAt,
            ).length;
            const releasedLeft = Math.max(0, monthlyAbsences - dailySeated);
            if (releasedLeft > 0) return null;
            return (
              <p className={`mt-2 ${darkAlertWarn}`}>
                Há {board.capacity - board.participants.length} vaga(s) livre(s), mas antes do prazo dos mensalistas
                diaristas na espera{" "}
                <strong className="font-semibold text-amber-50">só sobem se um mensalista liberar com “Não vou”</strong>
                {". Sem essa liberação, a vaga fica reservada até o prazo (depois sobe em FIFO) ou via “Incluir excepcionalmente” / “Promover…”."}
              </p>
            );
          })()}
        {canMarkAttendance && (
          <p className={`mt-1 ${shellSubtext}`}>
            Presença real: {presentCount} de {board.participants.length} marcados como presentes. Confirmar presença não é
            o mesmo que estar presente.
          </p>
        )}
      </div>

      {board.phase !== "CANCELLED" && (
        <>
          <Link href="/live" className={`${darkLinkCard} ring-1 ring-smv-gold/30`}>
            <span>
              <span className="block font-medium text-white">Ao Vivo</span>
              <span className={`block ${darkMuted}`}>Partidas, cronômetro, placar e Rei da Mesa</span>
            </span>
            <span aria-hidden="true" className="text-smv-gold-bright">
              ›
            </span>
          </Link>
          <Link href={`/admin/sessions/${session.id}/draw`} className={darkLinkCard}>
            <span>
              <span className="block font-medium text-white">Sorteio e votação</span>
              <span className={`block ${darkMuted}`}>Formação, rotativos, opções de times e votos</span>
            </span>
            <span aria-hidden="true" className="text-white/40">
              ›
            </span>
          </Link>
        </>
      )}

      {scoutBoard ? (
        <SessionScoutsPanel
          sessionId={session.id}
          canManage={scoutBoard.canManage}
          active={scoutBoard.active}
          history={scoutBoard.history}
          candidates={scoutBoard.candidates}
        />
      ) : null}

      {session.status !== "FINISHED" && board.phase !== "CANCELLED" ? (
        <EndSessionForm sessionId={session.id} />
      ) : null}

      <RegistrationList
        title={`Confirmados · ${board.participants.length}/${board.capacity}`}
        registrations={board.participants}
        empty="Ninguém confirmado ainda."
        extra={confirmedActions}
        layout="compact"
        showCount={false}
      />
      <RegistrationList
        title="Lista de espera"
        registrations={board.waitlist}
        empty="Ninguém na lista de espera."
        extra={waitlistActions}
        layout="compact"
      />

      {canChangeList && (!board.attendanceLocked || earlyDrawWaitlist) && (
        <ConfirmOnBehalfForm
          sessionId={session.id}
          note={
            earlyDrawWaitlist
              ? "Sorteio antecipado: até o prazo, só mensalistas podem ser confirmados, e entram na lista de espera."
              : undefined
          }
          candidates={confirmable.map((member) => ({
            value: member.id,
            label: `${member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name} · ${
              member.modality === "MONTHLY" ? "Mensalista" : "Diarista"
            }`,
          }))}
        />
      )}
      {canChangeList && board.attendanceLocked && !earlyDrawWaitlist && (
        <p className={darkEmptyCompact}>
          Votação iniciada: “Confirmar pelo jogador” fica indisponível (mesmas regras do jogador). Use inclusão
          excepcional ou promoção com motivo.
        </p>
      )}
      {canChangeList && (
        <IncludeForm
          sessionId={session.id}
          full={board.participants.length >= board.capacity}
          candidates={roster.includable.map((member) => ({
            value: member.id,
            label: member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name,
          }))}
          participants={board.participants.map((registration) => ({
            value: registration.id,
            label: displayName(registration),
          }))}
        />
      )}

      <NameList title="Mensalistas sem resposta" names={roster.noResponseMonthly.map((member) => member.user.name)} />
      <NameList title="Não vão" names={board.declined.map(displayName)} />
      <NameList title="Desistiram" names={board.withdrawn.map(displayName)} />
      <NameList
        title="Removidos pelo ADMIN"
        names={board.removed.map((registration) => `${displayName(registration)} — ${registration.manualOverrideReason ?? ""}`)}
      />

      {canCancelExtraordinary && <CancelExtraordinaryForm sessionId={session.id} />}

      {process.env.NODE_ENV === "development" && (
        <DevTestToolsSection
          sessionId={session.id}
          sessionLabel={formatSessionTitle(session.startsAt, timeZone)}
        />
      )}
    </section>
  );
}

async function DevTestToolsSection({ sessionId, sessionLabel }: { sessionId: string; sessionLabel: string }) {
  const [matchCount, drawCount, teamCount, registrationCount] = await Promise.all([
    db.match.count({ where: { gameSessionId: sessionId } }),
    db.draw.count({ where: { gameSessionId: sessionId } }),
    db.sessionTeam.count({ where: { gameSessionId: sessionId } }),
    db.sessionRegistration.count({ where: { gameSessionId: sessionId } }),
  ]);
  return (
    <DevTestTools
      sessionId={sessionId}
      sessionLabel={sessionLabel}
      matchCount={matchCount}
      drawCount={drawCount}
      teamCount={teamCount}
      registrationCount={registrationCount}
    />
  );
}

function NameList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className={shellSectionLabel}>
        {title} ({names.length})
      </h2>
      <p className={`${darkCardPad} ${darkBody}`}>{names.join(", ")}</p>
    </section>
  );
}
