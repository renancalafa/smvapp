import type { SessionBoard } from "@/server/modules/sessions/queries";
import { displayName } from "./format";

type Registration = SessionBoard["participants"][number];

/** Lista numerada de nomes; `extra` acrescenta conteúdo por linha (ex.: ações do ADMIN). */
export function RegistrationList({
  title,
  registrations,
  highlightMemberId,
  empty,
  extra,
}: {
  title: string;
  registrations: Registration[];
  highlightMemberId?: string;
  empty: string;
  extra?: (registration: Registration) => React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-500">
        {title} ({registrations.length})
      </h2>
      {registrations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {registrations.map((registration, index) => (
            <li
              key={registration.id}
              className={`flex flex-col gap-2 px-4 py-3 ${registration.memberId === highlightMemberId ? "bg-emerald-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-zinc-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-900">{displayName(registration)}</span>
                <span className="flex shrink-0 gap-1">
                  {registration.modalitySnapshot === "MONTHLY" && <Tag>Mensalista</Tag>}
                  {registration.status === "WAITLISTED" && registration.priorityTier === "MONTHLY_PRIORITY" && (
                    <Tag>Prioridade</Tag>
                  )}
                  {registration.promotedAt && <Tag>Promovido</Tag>}
                  {registration.manualOverrideAt && registration.status !== "REMOVED" && <Tag>Admin</Tag>}
                </span>
              </div>
              {extra?.(registration)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{children}</span>;
}
