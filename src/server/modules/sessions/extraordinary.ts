import "server-only";
import { civilDateToDb } from "@/domain/time/zoned";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import { formatSessionDay, lockSession, participantsFrozen } from "./engine";
import {
  CANCEL_REASON_MAX_LENGTH,
  DEFAULT_EXTRAORDINARY_VENUE,
  type CreateExtraordinaryInput,
} from "./extraordinary-input";
import { resolveSeasonId } from "./schedule";

export type { CreateExtraordinaryInput } from "./extraordinary-input";
export { CANCEL_REASON_MAX_LENGTH, DEFAULT_EXTRAORDINARY_VENUE } from "./extraordinary-input";
const VENUE_MAX_LENGTH = 80;

function assertAdmin(viewer: Viewer): void {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
}

function normalizeVenueName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_EXTRAORDINARY_VENUE;
  if (trimmed.length > VENUE_MAX_LENGTH) {
    throw new UserFacingError(`O local pode ter no máximo ${VENUE_MAX_LENGTH} caracteres.`);
  }
  return trimmed;
}

function validateCreateInput(input: CreateExtraordinaryInput, now: Date): CreateExtraordinaryInput {
  const venueName = normalizeVenueName(input.venueName);
  if (!(input.endsAt > input.startsAt)) {
    throw new UserFacingError("O horário de término deve ser depois do início.");
  }
  if (input.endsAt <= now) {
    throw new UserFacingError("Não é possível criar uma sessão que já teria terminado.");
  }
  if (!(input.registrationOpensAt <= input.startsAt)) {
    throw new UserFacingError("A abertura da lista precisa ser até o início da sessão.");
  }
  if (!(input.priorityDeadlineAt >= input.registrationOpensAt)) {
    throw new UserFacingError("O prazo dos mensalistas precisa ser na abertura da lista ou depois.");
  }
  if (!(input.priorityDeadlineAt <= input.startsAt)) {
    throw new UserFacingError("O prazo dos mensalistas precisa ser até o início da sessão.");
  }
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 1) {
    throw new UserFacingError("Informe um máximo de jogadores válido (inteiro ≥ 1).");
  }
  if (input.maxPlayers > 40) {
    throw new UserFacingError("O máximo de jogadores permitido é 40.");
  }
  return { ...input, venueName };
}

/**
 * Cria sessão EXTRAORDINARY (treino) com snapshot de GroupSettings.
 * Trava o Group e rejeita sobreposição com qualquer sessão não cancelada do grupo.
 */
export async function createExtraordinarySession(
  viewer: Viewer,
  raw: CreateExtraordinaryInput,
): Promise<{ sessionId: string }> {
  assertAdmin(viewer);
  const now = new Date();
  const input = validateCreateInput(raw, now);

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Group" WHERE "id" = ${viewer.group.id}::uuid FOR UPDATE`;

      const group = await tx.group.findUnique({
        where: { id: viewer.group.id },
        select: { id: true, timezone: true, settings: true },
      });
      if (!group?.settings) throw new UserFacingError("Configuração do grupo não encontrada.");
      const settings = group.settings;

      if (input.maxPlayers < settings.teamSize) {
        throw new UserFacingError(
          `O máximo de jogadores precisa ser pelo menos o tamanho do time (${settings.teamSize}).`,
        );
      }

      const conflicts = await tx.gameSession.findMany({
        where: {
          groupId: viewer.group.id,
          status: { not: "CANCELLED" },
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true, origin: true, venueName: true },
      });
      if (conflicts.length > 0) {
        const other = conflicts[0]!;
        const label = other.origin === "AUTOMATIC" ? "automática" : "extraordinária";
        throw new UserFacingError(
          `Já existe uma sessão ${label} nesse horário (${formatSessionDay({
            startsAt: other.startsAt,
            group: { timezone: group.timezone },
          })}). Escolha outro intervalo.`,
        );
      }

      const seasonId = await resolveSeasonId(tx, viewer.group.id, input.scheduledFor);
      const opensNow = input.registrationOpensAt <= now;
      const priorityClosed = input.priorityDeadlineAt <= now;

      const session = await tx.gameSession.create({
        data: {
          groupId: viewer.group.id,
          seasonId,
          origin: "EXTRAORDINARY",
          type: "NORMAL",
          status: opensNow ? "OPEN" : "SCHEDULED",
          scheduledFor: civilDateToDb(input.scheduledFor),
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          maxExtraMinutes: settings.maxExtraMinutes,
          registrationOpensAt: input.registrationOpensAt,
          openedAt: opensNow ? now : null,
          priorityDeadlineAt: input.priorityDeadlineAt,
          priorityClosedAt: priorityClosed ? now : null,
          maxPlayers: input.maxPlayers,
          teamSize: settings.teamSize,
          matchDurationSec: settings.matchDurationSec,
          drawOptionsCount: settings.drawOptionsCount,
          drawMinOptionDifference: settings.drawMinOptionDifference,
          dailyFeeCents: settings.dailyFeeCents,
          venueName: input.venueName,
          createdByUserId: viewer.user.id,
        },
        select: { id: true },
      });

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "SESSION_CREATED",
        entityType: "GameSession",
        entityId: session.id,
        gameSessionId: session.id,
        after: {
          origin: "EXTRAORDINARY",
          type: "NORMAL",
          scheduledFor: civilDateToDb(input.scheduledFor).toISOString().slice(0, 10),
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          registrationOpensAt: input.registrationOpensAt.toISOString(),
          priorityDeadlineAt: input.priorityDeadlineAt.toISOString(),
          maxPlayers: input.maxPlayers,
          venueName: input.venueName,
          status: opensNow ? "OPEN" : "SCHEDULED",
        },
      });

      return { sessionId: session.id };
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * Cancela sessão EXTRAORDINARY antes do gameplay (cronômetro).
 * Preserva inscrições, sorteios e votos; só marca CANCELLED + AuditLog + outbox.
 */
export async function cancelExtraordinarySession(
  viewer: Viewer,
  sessionId: string,
  reasonRaw: string,
): Promise<void> {
  assertAdmin(viewer);
  const reason = reasonRaw.trim().replace(/\s+/g, " ");
  if (!reason) throw new UserFacingError("Informe o motivo do cancelamento.");
  if (reason.length > CANCEL_REASON_MAX_LENGTH) {
    throw new UserFacingError(`O motivo pode ter no máximo ${CANCEL_REASON_MAX_LENGTH} caracteres.`);
  }

  await db.$transaction(async (tx) => {
    const locked = await lockSession(tx, sessionId);
    if (!locked || locked.groupId !== viewer.group.id) {
      throw new UserFacingError("Sessão não encontrada.");
    }
    if (locked.origin !== "EXTRAORDINARY") {
      throw new UserFacingError("Só sessões extraordinárias podem ser canceladas por este fluxo.");
    }
    if (locked.status === "CANCELLED") {
      throw new UserFacingError("Esta sessão já está cancelada.");
    }
    if (locked.status === "FINISHED") {
      throw new UserFacingError("Sessão encerrada não pode ser cancelada.");
    }
    if (await participantsFrozen(tx, locked.id)) {
      throw new UserFacingError(
        "As partidas já começaram: não é possível cancelar esta sessão. Encerre pelo Modo Pelada se precisar.",
      );
    }

    const updated = await tx.gameSession.updateMany({
      where: {
        id: locked.id,
        status: { notIn: ["CANCELLED", "FINISHED"] },
        origin: "EXTRAORDINARY",
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: viewer.user.id,
        cancelReason: reason,
      },
    });
    if (updated.count !== 1) {
      throw new UserFacingError("A sessão foi alterada por outra pessoa. Recarregue a página.");
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_CANCELLED",
      entityType: "GameSession",
      entityId: locked.id,
      gameSessionId: locked.id,
      reason,
      before: { status: locked.status },
      after: { status: "CANCELLED", cancelReason: reason },
    });

    const members = await tx.groupMember.findMany({
      where: { groupId: viewer.group.id, status: "ACTIVE" },
      select: { userId: true },
    });
    const dayLabel = formatSessionDay(locked);
    for (const member of members) {
      await tx.notification.create({
        data: {
          groupId: viewer.group.id,
          recipientUserId: member.userId,
          type: "SESSION_CANCELLED",
          title: "Sessão cancelada",
          body: `A sessão extraordinária de ${dayLabel} foi cancelada: ${reason}`,
          data: { url: `/sessions/${locked.id}`, gameSessionId: locked.id },
          dedupeKey: `SESSION_CANCELLED:${locked.id}:${member.userId}`,
        },
      });
    }
  });
}
