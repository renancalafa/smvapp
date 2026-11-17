import "server-only";
import type { Weekday } from "@/generated/prisma/client";
import {
  agendaTimingErrorMessage,
  validateAgendaTiming,
  type AgendaTimingInput,
} from "@/domain/schedule/agendaSettings";
import type { WeekdayName } from "@/domain/time/zoned";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";

const WEEKDAYS = new Set<WeekdayName>([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

export type SessionFormatSettingsInput = {
  sessionWeekday: WeekdayName;
  sessionStartMinute: number;
  sessionEndMinute: number;
  maxExtraMinutes: number;
  maxPlayers: number;
  teamSize: number;
  matchDurationSec: number;
  drawOptionsCount: number;
  drawMinOptionDifference: number;
  sessionAutoCreateLeadDays: number;
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
};

/**
 * Atualiza formato/agenda da sessão regular.
 * Só afeta sessões futuras (GameSession grava snapshot na criação).
 */
export async function updateSessionFormatSettings(
  viewer: Viewer,
  input: SessionFormatSettingsInput,
): Promise<void> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!WEEKDAYS.has(input.sessionWeekday)) {
    throw new UserFacingError("Dia da semana inválido.");
  }
  if (
    !Number.isInteger(input.sessionStartMinute) ||
    input.sessionStartMinute < 0 ||
    input.sessionStartMinute > 1439 ||
    !Number.isInteger(input.sessionEndMinute) ||
    input.sessionEndMinute < 0 ||
    input.sessionEndMinute > 1439 ||
    input.sessionEndMinute <= input.sessionStartMinute
  ) {
    throw new UserFacingError("Horário de início/término inválido (término depois do início).");
  }
  if (!Number.isInteger(input.maxExtraMinutes) || input.maxExtraMinutes < 0 || input.maxExtraMinutes > 30) {
    throw new UserFacingError("Tempo extra deve ser entre 0 e 30 minutos.");
  }
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 1 || input.maxPlayers > 40) {
    throw new UserFacingError("Máximo de jogadores inválido (1–40).");
  }
  if (!Number.isInteger(input.teamSize) || input.teamSize < 1 || input.teamSize > input.maxPlayers) {
    throw new UserFacingError("Tamanho do time inválido.");
  }
  if (!Number.isInteger(input.matchDurationSec) || input.matchDurationSec < 60 || input.matchDurationSec > 3600) {
    throw new UserFacingError("Duração da partida inválida.");
  }
  if (!Number.isInteger(input.drawOptionsCount) || input.drawOptionsCount < 1 || input.drawOptionsCount > 5) {
    throw new UserFacingError("Quantidade de opções de sorteio inválida.");
  }
  if (
    !Number.isInteger(input.drawMinOptionDifference) ||
    input.drawMinOptionDifference < 0 ||
    input.drawMinOptionDifference > 50
  ) {
    throw new UserFacingError("Diferença mínima entre opções de sorteio inválida.");
  }

  const timing: AgendaTimingInput = {
    sessionWeekday: input.sessionWeekday,
    sessionStartMinute: input.sessionStartMinute,
    sessionEndMinute: input.sessionEndMinute,
    sessionAutoCreateLeadDays: input.sessionAutoCreateLeadDays,
    registrationOpensDaysBefore: input.registrationOpensDaysBefore,
    registrationOpensMinute: input.registrationOpensMinute,
    priorityDeadlineDaysBefore: input.priorityDeadlineDaysBefore,
    priorityDeadlineMinute: input.priorityDeadlineMinute,
    priorityReminderDaysBefore: input.priorityReminderDaysBefore,
    priorityReminderMinute: input.priorityReminderMinute,
    priorityReminderEnabled: input.priorityReminderEnabled,
  };
  const timingError = validateAgendaTiming(timing, viewer.group.timezone);
  if (timingError) throw new UserFacingError(agendaTimingErrorMessage(timingError));

  await db.$transaction(async (tx) => {
    const current = await tx.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
    });
    if (!current) throw new UserFacingError("Configurações do grupo não encontradas.");

    const before = {
      sessionWeekday: current.sessionWeekday,
      sessionStartMinute: current.sessionStartMinute,
      sessionEndMinute: current.sessionEndMinute,
      maxExtraMinutes: current.maxExtraMinutes,
      maxPlayers: current.maxPlayers,
      teamSize: current.teamSize,
      matchDurationSec: current.matchDurationSec,
      drawOptionsCount: current.drawOptionsCount,
      drawMinOptionDifference: current.drawMinOptionDifference,
      sessionAutoCreateLeadDays: current.sessionAutoCreateLeadDays,
      registrationOpensDaysBefore: current.registrationOpensDaysBefore,
      registrationOpensMinute: current.registrationOpensMinute,
      priorityDeadlineDaysBefore: current.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: current.priorityDeadlineMinute,
      priorityReminderDaysBefore: current.priorityReminderDaysBefore,
      priorityReminderMinute: current.priorityReminderMinute,
      priorityReminderEnabled: current.priorityReminderEnabled,
    };
    const after = { ...input, sessionWeekday: input.sessionWeekday as Weekday };
    const unchanged = (Object.keys(before) as (keyof typeof before)[]).every(
      (key) => before[key] === after[key],
    );
    if (unchanged) return;

    await tx.groupSettings.update({
      where: { groupId: viewer.group.id },
      data: {
        sessionWeekday: input.sessionWeekday as Weekday,
        sessionStartMinute: input.sessionStartMinute,
        sessionEndMinute: input.sessionEndMinute,
        maxExtraMinutes: input.maxExtraMinutes,
        maxPlayers: input.maxPlayers,
        teamSize: input.teamSize,
        matchDurationSec: input.matchDurationSec,
        drawOptionsCount: input.drawOptionsCount,
        drawMinOptionDifference: input.drawMinOptionDifference,
        sessionAutoCreateLeadDays: input.sessionAutoCreateLeadDays,
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
      metadata: { section: "session_format" },
    });
  });
}
