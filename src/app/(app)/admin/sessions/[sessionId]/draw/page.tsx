import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { planDraw } from "@/domain/draw/balance";
import { requireAdmin } from "@/server/auth/dal";
import { getActiveDraw, getDrawHistory, getFormation, type DrawView } from "@/server/modules/draws/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { drawStatusText } from "../../../../sessions/draw/draw-section";
import { OptionCard } from "../../../../sessions/draw/option-card";
import { formatDateTime, formatSessionTitle } from "../../../../sessions/format";
import {
  CloseVotingForm,
  GenerateDrawForm,
  InvalidateDrawForm,
  OverflowModeForm,
  ResolveTieForm,
  RotatorToggle,
} from "./draw-admin-forms";

export const metadata: Metadata = { title: "Sorteio" };

export default async function AdminDrawPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await requireAdmin();
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  await syncSessionsForRead(viewer.group.id);
  const board = await getSessionBoard(viewer.group.id, sessionId);
  if (!board) notFound();

  const [draw, history, formation] = await Promise.all([
    getActiveDraw(sessionId, viewer.member.id, true),
    getDrawHistory(sessionId, viewer.member.id),
    getFormation(sessionId),
  ]);
  const timeZone = viewer.group.timezone;
  const live = board.phase !== "CANCELLED" && board.phase !== "CLOSED";
  const canCommand = live && !formation.hasMatches;

  const participants = formation.participants.length;
  const three = formation.teamSize * 3;
  const four = formation.teamSize * 4;
  const overflowRange = participants > three && participants < four;
  const plan = planDraw({ participants, teamSize: formation.teamSize, overflowMode: formation.overflowMode });
  const rotatorsMarked = formation.participants.filter((participant) => participant.isRotating).length;
  const showRotators = formation.overflowMode === "FLEXIBLE_ROTATION" && plan.ok && plan.rotatorsRequired > 0;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href={`/admin/sessions/${sessionId}`} className="text-sm text-zinc-500">
          ‹ Sessão
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Sorteio</h1>
        <p className="text-sm capitalize text-zinc-600">{formatSessionTitle(board.session.startsAt, timeZone)}</p>
        {formation.hasMatches && (
          <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            As partidas já começaram: o sorteio e os times são histórico e não mudam mais.
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium text-zinc-900">Formação</h2>
        <p className="text-sm text-zinc-600">
          {participants} participantes ·{" "}
          {plan.ok
            ? `${plan.teamCount} times de ${formation.teamSize}${plan.rotatorsRequired > 0 ? ` + ${plan.rotatorsRequired} rotativo(s)` : ""}`
            : plan.error}
        </p>
        {!formation.priorityClosedAt && (
          <p className="text-sm text-amber-700">O sorteio fica disponível depois do prazo dos mensalistas.</p>
        )}
        {(overflowRange || formation.overflowMode) && (
          <OverflowModeForm
            sessionId={sessionId}
            current={formation.overflowMode}
            disabled={!canCommand || draw !== null || !formation.priorityClosedAt}
          />
        )}
        {showRotators && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-600">
              Rotativos marcados: {rotatorsMarked} de {plan.rotatorsRequired}. O algoritmo não escolhe rotativos.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {formation.participants.map((participant) => (
                <RotatorToggle
                  key={participant.id}
                  sessionId={sessionId}
                  registrationId={participant.id}
                  name={participant.name}
                  rotating={participant.isRotating}
                  disabled={!canCommand || draw !== null}
                />
              ))}
            </div>
          </div>
        )}
        {!draw && canCommand && formation.priorityClosedAt && plan.ok && <GenerateDrawForm sessionId={sessionId} />}
      </section>

      {draw ? (
        <ActiveDraw draw={draw} sessionId={sessionId} canCommand={canCommand} timeZone={timeZone} />
      ) : (
        <p className="text-sm text-zinc-500">Nenhum sorteio ativo.</p>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Sorteios invalidados ({history.length})</h2>
          {history.map((old) => (
            <details key={old.id} className="rounded-xl border border-zinc-200 bg-white p-4">
              <summary className="cursor-pointer text-sm text-zinc-800">
                Sorteio {old.sequence} · invalidado {old.invalidatedAt ? formatDateTime(old.invalidatedAt, timeZone) : ""}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm text-zinc-600">Motivo: {old.invalidationReason}</p>
                {old.winningOptionId && (
                  <p className="text-sm text-zinc-600">
                    Era o oficial: opção {old.options.find((option) => option.id === old.winningOptionId)?.label}.
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  {old.options.map((option) => (
                    <OptionCard key={option.id} option={option} official={option.id === old.winningOptionId} mine={false} />
                  ))}
                </div>
              </div>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}

function ActiveDraw({
  draw,
  sessionId,
  canCommand,
  timeZone,
}: {
  draw: DrawView;
  sessionId: string;
  canCommand: boolean;
  timeZone: string;
}) {
  const totalVotes = draw.options.reduce((sum, option) => sum + option.votes, 0);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Sorteio {draw.sequence}</h2>
        <p className="text-sm text-zinc-600">{drawStatusText(draw)}</p>
        <p className="text-xs text-zinc-500">
          Gerado {formatDateTime(draw.createdAt, timeZone)}
          {draw.optionDistance !== null &&
            ` · diferença entre as opções: ${draw.optionDistance} jogadores (mínimo ${draw.minOptionDifference})`}
        </p>
        {draw.status === "VOTING" && (
          <p className="mt-1 text-sm text-zinc-600">
            {totalVotes} de {draw.eligibleVoters} mensalistas elegíveis votaram
            {draw.ignoredVotes > 0 ? ` (${draw.ignoredVotes} voto(s) de quem deixou de ser elegível não contam)` : ""}.
          </p>
        )}
      </div>

      {canCommand && draw.status === "VOTING" && <CloseVotingForm sessionId={sessionId} drawId={draw.id} />}
      {canCommand && draw.status === "TIED" && (
        <ResolveTieForm
          sessionId={sessionId}
          drawId={draw.id}
          options={draw.options.map((option) => ({ value: option.id, label: `Opção ${option.label} (${option.votes} votos)` }))}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {draw.options.map((option) => (
          <OptionCard key={option.id} option={option} official={option.id === draw.winningOptionId} mine={false} />
        ))}
      </div>

      {canCommand && <InvalidateDrawForm sessionId={sessionId} drawId={draw.id} decided={draw.status === "DECIDED"} />}
    </section>
  );
}
