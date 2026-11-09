import "server-only";
import type { Weekday } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import type { AgendaSettingsInput } from "./validation";

function assertAdmin(viewer: Viewer): void {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
}

function agendaSnapshot(row: {
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
}) {
  return {
    registrationOpensDaysBefore: row.registrationOpensDaysBefore,
    registrationOpensMinute: row.registrationOpensMinute,
    priorityDeadlineDaysBefore: row.priorityDeadlineDaysBefore,
    priorityDeadlineMinute: row.priorityDeadlineMinute,
    priorityReminderDaysBefore: row.priorityReminderDaysBefore,
    priorityReminderMinute: row.priorityReminderMinute,
    priorityReminderEnabled: row.priorityReminderEnabled,
  };
}

/**
 * Atualiza só a agenda (abertura / prazo / lembrete). Não reescreve GameSession
 * já criada: ensureUpcomingSessions usa o snapshot no create.
 */
export async function updateAgendaSettings(viewer: Viewer, input: AgendaSettingsInput): Promise<void> {
  assertAdmin(viewer);

  await db.$transaction(async (tx) => {
    const current = await tx.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
      select: {
        registrationOpensDaysBefore: true,
        registrationOpensMinute: true,
        priorityDeadlineDaysBefore: true,
        priorityDeadlineMinute: true,
        priorityReminderDaysBefore: true,
        priorityReminderMinute: true,
        priorityReminderEnabled: true,
        sessionWeekday: true,
      },
    });
    if (!current) throw new UserFacingError("Configurações do grupo não encontradas.");

    const before = agendaSnapshot(current);
    const after = agendaSnapshot(input);
    const unchanged =
      before.registrationOpensDaysBefore === after.registrationOpensDaysBefore &&
      before.registrationOpensMinute === after.registrationOpensMinute &&
      before.priorityDeadlineDaysBefore === after.priorityDeadlineDaysBefore &&
      before.priorityDeadlineMinute === after.priorityDeadlineMinute &&
      before.priorityReminderDaysBefore === after.priorityReminderDaysBefore &&
      before.priorityReminderMinute === after.priorityReminderMinute &&
      before.priorityReminderEnabled === after.priorityReminderEnabled;
    if (unchanged) return;

    await tx.groupSettings.update({
      where: { groupId: viewer.group.id },
      data: {
        registrationOpensDaysBefore: input.registrationOpensDaysBefore,
        registrationOpensMinute: input.registrationOpensMinute,
        priorityDeadlineDaysBefore: input.priorityDeadlineDaysBefore,
        priorityDeadlineMinute: input.priorityDeadlineMinute,
        priorityReminderDaysBefore: input.priorityReminderDaysBefore,
        priorityReminderMinute: input.priorityReminderMinute,
        priorityReminderEnabled: input.priorityReminderEnabled,
        updatedByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "GROUP_SETTINGS_UPDATED",
      entityType: "GroupSettings",
      entityId: viewer.group.id,
      before,
      after,
      metadata: { section: "agenda", sessionWeekday: current.sessionWeekday as Weekday },
    });
  });
}
