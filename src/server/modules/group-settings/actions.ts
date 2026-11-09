"use server";

import { refresh } from "next/cache";
import type { WeekdayName } from "@/domain/time/zoned";
import { requireAdminAction } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { getAgendaSettings } from "./queries";
import { updateAgendaSettings } from "./service";
import { readAgendaForm, validateAgendaForm, type AgendaFormValues } from "./validation";

export type UpdateAgendaState =
  | { status: "error"; error: string; values: AgendaFormValues }
  | { status: "saved" }
  | undefined;

const UNEXPECTED_ERROR = "Não foi possível salvar a agenda. Tente novamente em instantes.";

export async function updateAgendaSettingsAction(
  _previous: UpdateAgendaState,
  formData: FormData,
): Promise<UpdateAgendaState> {
  const viewer = await requireAdminAction();
  const values = readAgendaForm(formData);
  const settings = await getAgendaSettings(viewer.group.id);
  if (!settings) {
    return { status: "error", error: "Configurações do grupo não encontradas.", values };
  }

  const parsed = validateAgendaForm(values, {
    timeZone: viewer.group.timezone,
    sessionWeekday: settings.sessionWeekday as WeekdayName,
    sessionStartMinute: settings.sessionStartMinute,
    sessionEndMinute: settings.sessionEndMinute,
    sessionAutoCreateLeadDays: settings.sessionAutoCreateLeadDays,
  });
  if (!parsed.ok) return { status: "error", error: parsed.error, values };

  try {
    await updateAgendaSettings(viewer, parsed.input);
    refresh();
    return { status: "saved" };
  } catch (error) {
    if (error instanceof UserFacingError) {
      return { status: "error", error: error.message, values };
    }
    console.error("updateAgendaSettingsAction", error);
    return { status: "error", error: UNEXPECTED_ERROR, values };
  }
}
