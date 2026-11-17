"use server";

import { refresh } from "next/cache";
import type { WeekdayName } from "@/domain/time/zoned";
import { requireAdminAction } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { getSessionFormatSettings } from "./queries";
import { updateSessionFormatSettings } from "./session-settings";
import { parseTimeToMinute } from "./validation";

export type UpdateSessionFormatState =
  | { status: "error"; error: string }
  | { status: "saved" }
  | undefined;

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function formInt(formData: FormData, key: string): number | null {
  const n = Number(formText(formData, key));
  return Number.isInteger(n) ? n : null;
}

export async function updateSessionFormatAction(
  _prev: UpdateSessionFormatState,
  formData: FormData,
): Promise<UpdateSessionFormatState> {
  try {
    const viewer = await requireAdminAction();
    const settings = await getSessionFormatSettings(viewer.group.id);
    if (!settings) return { status: "error", error: "Configurações não encontradas." };

    const sessionWeekday = formText(formData, "sessionWeekday") as WeekdayName;
    const sessionStartMinute = parseTimeToMinute(formText(formData, "sessionStartTime"));
    const sessionEndMinute = parseTimeToMinute(formText(formData, "sessionEndTime"));
    if (sessionStartMinute == null || sessionEndMinute == null) {
      return { status: "error", error: "Informe horários válidos (HH:MM)." };
    }

    const registrationOpensMinute = parseTimeToMinute(formText(formData, "registrationOpensTime"));
    const priorityDeadlineMinute = parseTimeToMinute(formText(formData, "priorityDeadlineTime"));
    const priorityReminderMinute = parseTimeToMinute(formText(formData, "priorityReminderTime"));
    if (
      registrationOpensMinute == null ||
      priorityDeadlineMinute == null ||
      priorityReminderMinute == null
    ) {
      return { status: "error", error: "Informe horários de agenda válidos." };
    }

    const maxExtraMinutes = formInt(formData, "maxExtraMinutes");
    const maxPlayers = formInt(formData, "maxPlayers");
    const teamSize = formInt(formData, "teamSize");
    const matchDurationSec = formInt(formData, "matchDurationSec");
    const drawOptionsCount = formInt(formData, "drawOptionsCount");
    const drawMinOptionDifference = formInt(formData, "drawMinOptionDifference");
    const sessionAutoCreateLeadDays = formInt(formData, "sessionAutoCreateLeadDays");
    const registrationOpensDaysBefore = formInt(formData, "registrationOpensDaysBefore");
    const priorityDeadlineDaysBefore = formInt(formData, "priorityDeadlineDaysBefore");
    const priorityReminderDaysBefore = formInt(formData, "priorityReminderDaysBefore");
    if (
      maxExtraMinutes == null ||
      maxPlayers == null ||
      teamSize == null ||
      matchDurationSec == null ||
      drawOptionsCount == null ||
      drawMinOptionDifference == null ||
      sessionAutoCreateLeadDays == null ||
      registrationOpensDaysBefore == null ||
      priorityDeadlineDaysBefore == null ||
      priorityReminderDaysBefore == null
    ) {
      return { status: "error", error: "Preencha todos os campos numéricos com valores inteiros." };
    }

    const reminderRaw = formText(formData, "priorityReminderEnabled").toLowerCase();
    const priorityReminderEnabled = reminderRaw === "true" || reminderRaw === "on";

    await updateSessionFormatSettings(viewer, {
      sessionWeekday,
      sessionStartMinute,
      sessionEndMinute,
      maxExtraMinutes,
      maxPlayers,
      teamSize,
      matchDurationSec,
      drawOptionsCount,
      drawMinOptionDifference,
      sessionAutoCreateLeadDays,
      registrationOpensDaysBefore,
      registrationOpensMinute,
      priorityDeadlineDaysBefore,
      priorityDeadlineMinute,
      priorityReminderDaysBefore,
      priorityReminderMinute,
      priorityReminderEnabled,
    });
    refresh();
    return { status: "saved" };
  } catch (error) {
    if (error instanceof UserFacingError) return { status: "error", error: error.message };
    console.error("updateSessionFormatAction", error);
    return { status: "error", error: "Não foi possível salvar. Tente de novo." };
  }
}
