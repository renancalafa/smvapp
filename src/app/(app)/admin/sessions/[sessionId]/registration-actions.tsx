"use client";

import { useActionState } from "react";
import type { AttendanceStatus, RegistrationStatus } from "@/generated/prisma/enums";
import { adminPromoteAction, adminRemoveAction, markAttendanceAction } from "@/server/modules/sessions/actions";

export function RegistrationActions({
  sessionId,
  registrationId,
  status,
  attendance,
  canChangeList,
  canMarkAttendance,
  hasFreeSpot,
}: {
  sessionId: string;
  registrationId: string;
  status: RegistrationStatus;
  attendance: AttendanceStatus | null;
  canChangeList: boolean;
  canMarkAttendance: boolean;
  hasFreeSpot: boolean;
}) {
  const [removeState, removeAction, removing] = useActionState(adminRemoveAction, undefined);
  const [promoteState, promoteAction, promoting] = useActionState(adminPromoteAction, undefined);
  const [attendanceState, attendanceAction, marking] = useActionState(markAttendanceAction, undefined);
  const showAttendance = canMarkAttendance && status === "PARTICIPANT";
  const showPromote = canChangeList && hasFreeSpot && status === "WAITLISTED";
  if (!canChangeList && !showAttendance) return null;

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
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-zinc-700 bg-zinc-700 text-white"
                  : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              {value === "PRESENT" ? "Presente" : "Faltou"}
            </button>
          ))}
        </form>
      )}
      {attendanceState?.status === "error" && <p className="text-sm text-red-700">{attendanceState.error}</p>}

      {showPromote && (
        <details className="text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center text-emerald-700">Promover…</summary>
          <form action={promoteAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="registrationId" value={registrationId} />
            <input
              name="reason"
              required
              maxLength={300}
              placeholder="Motivo (obrigatório)"
              className="min-h-11 rounded-lg border border-zinc-300 px-3 text-base"
            />
            <button
              type="submit"
              disabled={promoting}
              className="min-h-11 rounded-lg bg-emerald-700 font-medium text-white disabled:opacity-60"
            >
              {promoting ? "Promovendo…" : "Promover a participante"}
            </button>
            {promoteState && (
              <p className={promoteState.status === "error" ? "text-red-700" : "text-emerald-700"}>
                {promoteState.status === "error" ? promoteState.error : promoteState.message}
              </p>
            )}
          </form>
        </details>
      )}

      {canChangeList && (
        <details className="text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center text-zinc-500">Remover…</summary>
          <form action={removeAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="registrationId" value={registrationId} />
            <input
              name="reason"
              required
              maxLength={300}
              placeholder="Motivo (obrigatório)"
              className="min-h-11 rounded-lg border border-zinc-300 px-3 text-base"
            />
            <button
              type="submit"
              disabled={removing}
              className="min-h-11 rounded-lg border border-red-200 bg-white font-medium text-red-700 disabled:opacity-60"
            >
              {removing ? "Removendo…" : "Remover da sessão"}
            </button>
            {removeState && (
              <p className={removeState.status === "error" ? "text-red-700" : "text-emerald-700"}>
                {removeState.status === "error" ? removeState.error : removeState.message}
              </p>
            )}
          </form>
        </details>
      )}
    </div>
  );
}
