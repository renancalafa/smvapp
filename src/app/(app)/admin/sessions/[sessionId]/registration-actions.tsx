"use client";

import { useActionState } from "react";
import type { AttendanceStatus, RegistrationStatus } from "@/generated/prisma/enums";
import {
  darkAlertError,
  darkAlertSuccess,
  darkBtnDanger,
  darkBtnPrimary,
  darkControl,
  darkMuted,
} from "@/lib/ui/dark-surfaces";
import { adminPromoteAction, adminRemoveAction, markAttendanceAction } from "@/server/modules/sessions/actions";

export function RegistrationActions({
  sessionId,
  registrationId,
  status,
  attendance,
  canChangeList,
  canMarkAttendance,
  hasFreeSpot,
  compact = false,
}: {
  sessionId: string;
  registrationId: string;
  status: RegistrationStatus;
  attendance: AttendanceStatus | null;
  canChangeList: boolean;
  canMarkAttendance: boolean;
  hasFreeSpot: boolean;
  /** Inline actions for compact Confirmados rows. */
  compact?: boolean;
}) {
  const [removeState, removeAction, removing] = useActionState(adminRemoveAction, undefined);
  const [promoteState, promoteAction, promoting] = useActionState(adminPromoteAction, undefined);
  const [attendanceState, attendanceAction, marking] = useActionState(markAttendanceAction, undefined);
  const showAttendance = canMarkAttendance && status === "PARTICIPANT";
  const showPromote = canChangeList && hasFreeSpot && status === "WAITLISTED";
  if (!canChangeList && !showAttendance) return null;

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        {showAttendance && (
          <form action={attendanceAction} className="flex gap-1">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="registrationId" value={registrationId} />
            {(["PRESENT", "ABSENT"] as const).map((value) => (
              <button
                key={value}
                type="submit"
                name="attendance"
                value={value}
                disabled={marking}
                aria-pressed={attendance === value}
                aria-label={value === "PRESENT" ? "Marcar presente" : "Marcar faltou"}
                className={`min-h-9 rounded-lg border px-2 text-xs font-medium ${
                  attendance === value
                    ? value === "PRESENT"
                      ? "border-emerald-300/40 bg-emerald-400/20 text-emerald-100"
                      : "border-white/25 bg-white/15 text-smv-cream"
                    : "border-white/15 bg-transparent text-white/70"
                }`}
              >
                {value === "PRESENT" ? "P" : "F"}
              </button>
            ))}
          </form>
        )}
        {attendanceState?.status === "error" && (
          <p className={`max-w-[12rem] text-right ${darkAlertError}`}>{attendanceState.error}</p>
        )}
        {canChangeList && (
          <details className="text-sm">
            <summary
              className={`flex min-h-9 cursor-pointer list-none items-center justify-end rounded-lg px-2 text-xs font-medium text-red-200/90 ring-1 ring-red-300/25 hover:bg-red-400/10 ${darkMuted}`}
            >
              Remover
            </summary>
            <form action={removeAction} className="mt-1 flex w-[min(16rem,70vw)] flex-col gap-2">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="registrationId" value={registrationId} />
              <input
                name="reason"
                required
                maxLength={300}
                placeholder="Motivo (obrigatório)"
                className={darkControl}
                aria-label="Motivo da remoção"
              />
              <button type="submit" disabled={removing} className={`w-full ${darkBtnDanger}`}>
                {removing ? "Removendo…" : "Confirmar remoção"}
              </button>
              {removeState && (
                <p className={removeState.status === "error" ? darkAlertError : darkAlertSuccess}>
                  {removeState.status === "error" ? removeState.error : removeState.message}
                </p>
              )}
            </form>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pl-9">
      {showAttendance && (
        <form action={attendanceAction} className="flex gap-2">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="registrationId" value={registrationId} />
          {(["PRESENT", "ABSENT"] as const).map((value) => (
            <button
              key={value}
              type="submit"
              name="attendance"
              value={value}
              disabled={marking}
              aria-pressed={attendance === value}
              className={`min-h-10 flex-1 rounded-lg border px-3 text-sm font-medium ${
                attendance === value
                  ? value === "PRESENT"
                    ? "border-emerald-300/40 bg-emerald-400/20 text-emerald-100"
                    : "border-white/25 bg-white/15 text-smv-cream"
                  : "border-white/15 bg-transparent text-white/70"
              }`}
            >
              {value === "PRESENT" ? "Presente" : "Faltou"}
            </button>
          ))}
        </form>
      )}
      {attendanceState?.status === "error" && (
        <p className={darkAlertError}>{attendanceState.error}</p>
      )}

      {showPromote && (
        <details className="text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center text-smv-gold-bright">
            Promover…
          </summary>
          <form action={promoteAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="registrationId" value={registrationId} />
            <input
              name="reason"
              required
              maxLength={300}
              placeholder="Motivo (obrigatório)"
              className={darkControl}
            />
            <button type="submit" disabled={promoting} className={`w-full ${darkBtnPrimary}`}>
              {promoting ? "Promovendo…" : "Promover a participante"}
            </button>
            {promoteState && (
              <p className={promoteState.status === "error" ? darkAlertError : darkAlertSuccess}>
                {promoteState.status === "error" ? promoteState.error : promoteState.message}
              </p>
            )}
          </form>
        </details>
      )}

      {canChangeList && (
        <details className="text-sm">
          <summary className={`flex min-h-10 cursor-pointer items-center ${darkMuted}`}>
            Remover…
          </summary>
          <form action={removeAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="registrationId" value={registrationId} />
            <input
              name="reason"
              required
              maxLength={300}
              placeholder="Motivo (obrigatório)"
              className={darkControl}
            />
            <button type="submit" disabled={removing} className={`w-full ${darkBtnDanger}`}>
              {removing ? "Removendo…" : "Remover da sessão"}
            </button>
            {removeState && (
              <p className={removeState.status === "error" ? darkAlertError : darkAlertSuccess}>
                {removeState.status === "error" ? removeState.error : removeState.message}
              </p>
            )}
          </form>
        </details>
      )}
    </div>
  );
}
