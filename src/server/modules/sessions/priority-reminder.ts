import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { formatSessionDay } from "./engine";

type Tx = Prisma.TransactionClient;

const DUE_SESSION_SELECT = {
  id: true,
  groupId: true,
  startsAt: true,
  priorityReminderAt: true,
  priorityDeadlineAt: true,
  group: { select: { timezone: true } },
} satisfies Prisma.GameSessionSelect;

type DueSession = Prisma.GameSessionGetPayload<{ select: typeof DUE_SESSION_SELECT }>;

export function priorityReminderDedupeKey(sessionId: string, userId: string): string {
  return `PRIORITY_REMINDER:${sessionId}:${userId}`;
}

export function gameSessionIdFromNotificationData(data: Prisma.JsonValue | null): string | null {
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.gameSessionId === "string") {
    return data.gameSessionId;
  }
  return null;
}

/** Cliente mínimo para revalidar / suprimir no dispatcher (testes injetam o mesmo shape). */
export type PriorityReminderGateClient = {
  gameSession: {
    findFirst(args: {
      where: Prisma.GameSessionWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  groupMember: {
    findFirst(args: {
      where: Prisma.GroupMemberWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  notification: {
    deleteMany(args: { where: Prisma.NotificationWhereInput }): Promise<{ count: number }>;
  };
};

/**
 * Elegível para entregar o lembrete agora: sessão ainda no prazo + mensalista ACTIVE
 * sem nenhuma inscrição nessa sessão. Usado no enqueue e de novo no dispatch.
 */
export async function isPriorityReminderStillDeliverable(
  client: PriorityReminderGateClient,
  input: { groupId: string; sessionId: string; userId: string; now: Date },
): Promise<boolean> {
  const session = await client.gameSession.findFirst({
    where: {
      id: input.sessionId,
      groupId: input.groupId,
      status: { notIn: ["CANCELLED", "FINISHED"] },
      priorityReminderAt: { not: null },
      priorityDeadlineAt: { gt: input.now },
      priorityClosedAt: null,
    },
    select: { id: true },
  });
  if (!session) return false;

  const member = await client.groupMember.findFirst({
    where: {
      groupId: input.groupId,
      userId: input.userId,
      status: "ACTIVE",
      modality: "MONTHLY",
      user: { disabledAt: null },
      registrations: { none: { gameSessionId: input.sessionId } },
    },
    select: { id: true },
  });
  return Boolean(member);
}

/** Remove o outbox/inbox do lembrete deste jogador nesta sessão (idempotente). */
export async function suppressPriorityReminderForUser(
  client: Pick<PriorityReminderGateClient, "notification">,
  input: { sessionId: string; userId: string },
): Promise<number> {
  const result = await client.notification.deleteMany({
    where: { dedupeKey: priorityReminderDedupeKey(input.sessionId, input.userId) },
  });
  return result.count;
}

/**
 * Se PRIORITY_REMINDER ficou obsoleto (respondeu, prazo passou, cancelou…), apaga a
 * notificação para não ir no push nem ficar na caixa. Outros tipos não são tocados.
 */
export async function suppressStalePriorityReminder(
  client: PriorityReminderGateClient,
  input: {
    notificationId: string;
    groupId: string;
    recipientUserId: string;
    data: Prisma.JsonValue | null;
    now: Date;
  },
): Promise<"kept" | "suppressed"> {
  const sessionId = gameSessionIdFromNotificationData(input.data);
  if (!sessionId) {
    await client.notification.deleteMany({ where: { id: input.notificationId } });
    return "suppressed";
  }
  const ok = await isPriorityReminderStillDeliverable(client, {
    groupId: input.groupId,
    sessionId,
    userId: input.recipientUserId,
    now: input.now,
  });
  if (ok) return "kept";
  await client.notification.deleteMany({ where: { id: input.notificationId } });
  return "suppressed";
}

/**
 * Outbox PRIORITY_REMINDER para mensalistas ACTIVE que ainda não responderam.
 * Avalia elegibilidade no instante do job; dedupeKey impede duplicata.
 */
export async function enqueuePriorityRemindersForSession(
  tx: Tx,
  session: DueSession,
): Promise<number> {
  if (!session.priorityReminderAt) return 0;

  const members = await tx.groupMember.findMany({
    where: {
      groupId: session.groupId,
      status: "ACTIVE",
      modality: "MONTHLY",
      user: { disabledAt: null },
      registrations: { none: { gameSessionId: session.id } },
    },
    select: { userId: true },
  });
  if (members.length === 0) return 0;

  const dayLabel = formatSessionDay(session);
  const result = await tx.notification.createMany({
    data: members.map((member) => ({
      groupId: session.groupId,
      recipientUserId: member.userId,
      type: "PRIORITY_REMINDER" as const,
      title: "Lembrete: prazo dos mensalistas",
      body: `Confirme sua presença na pelada de ${dayLabel} antes do fim da prioridade.`,
      data: { url: `/sessions/${session.id}`, gameSessionId: session.id },
      dedupeKey: priorityReminderDedupeKey(session.id, member.userId),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Sessões AUTOMATIC com lembrete vencido e prazo ainda aberto.
 * Idempotente via dedupeKey; canceladas / sem snapshot / após o prazo são ignoradas.
 */
export async function enqueueDuePriorityReminders(groupId: string, now = new Date()): Promise<number> {
  const sessions = await db.gameSession.findMany({
    where: {
      groupId,
      origin: "AUTOMATIC",
      status: { notIn: ["CANCELLED", "FINISHED"] },
      priorityReminderAt: { not: null, lte: now },
      priorityDeadlineAt: { gt: now },
      priorityClosedAt: null,
    },
    orderBy: { priorityReminderAt: "asc" },
    select: DUE_SESSION_SELECT,
  });

  let enqueued = 0;
  for (const session of sessions) {
    const count = await db.$transaction(async (tx) => enqueuePriorityRemindersForSession(tx, session));
    enqueued += count;
  }
  return enqueued;
}
