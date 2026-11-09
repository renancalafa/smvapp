import type { Metadata } from "next";
import Link from "next/link";
import { darkTitle } from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { getAgendaSettings } from "@/server/modules/group-settings/queries";
import { minuteOfDayToTime } from "@/server/modules/group-settings/validation";
import { AgendaForm } from "./agenda-form";

export const metadata: Metadata = { title: "Agenda" };

export default async function AdminAgendaPage() {
  const viewer = await requireAdmin();
  const settings = await getAgendaSettings(viewer.group.id);
  if (!settings) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className={darkTitle}>Agenda</h1>
        <p className={shellSubtext}>Configurações do grupo não encontradas.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className={darkTitle}>Agenda</h1>
        <Link href="/admin" className={`${shellBackLink} underline`}>
          Voltar
        </Link>
      </div>
      <AgendaForm
        defaults={{
          registrationOpensDaysBefore: settings.registrationOpensDaysBefore,
          registrationOpensMinute: settings.registrationOpensMinute,
          priorityDeadlineDaysBefore: settings.priorityDeadlineDaysBefore,
          priorityDeadlineMinute: settings.priorityDeadlineMinute,
          priorityReminderDaysBefore: settings.priorityReminderDaysBefore,
          priorityReminderMinute: settings.priorityReminderMinute,
          priorityReminderEnabled: settings.priorityReminderEnabled,
          sessionWeekday: settings.sessionWeekday,
          sessionStartLabel: minuteOfDayToTime(settings.sessionStartMinute),
          timeZone: viewer.group.timezone,
        }}
      />
    </section>
  );
}
