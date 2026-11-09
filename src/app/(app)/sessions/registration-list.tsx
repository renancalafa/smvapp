import { darkBadge, darkBadgeGold, darkEmpty, darkList } from "@/lib/ui/dark-surfaces";
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
  showCount = true,
}: {
  title: string;
  registrations: Registration[];
  highlightMemberId?: string;
  empty: string;
  extra?: (registration: Registration) => React.ReactNode;
  /** When false, `title` is shown as-is (useful if it already includes capacity). */
  showCount?: boolean;
}) {
  const heading = showCount ? `${title} (${registrations.length})` : title;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-white/65">{heading}</h3>
      {registrations.length === 0 ? (
        <p className={darkEmpty}>{empty}</p>
      ) : (
        <ol className={darkList}>
          {registrations.map((registration, index) => {
            const highlighted = registration.memberId === highlightMemberId;
            return (
              <li
                key={registration.id}
                className={`flex flex-col gap-2 px-3 py-3 sm:px-4 ${
                  highlighted ? "bg-smv-gold/10 ring-1 ring-inset ring-smv-gold/25" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="w-6 shrink-0 pt-0.5 text-right text-sm tabular-nums text-white/40">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{displayName(registration)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {registration.modalitySnapshot === "MONTHLY" && <Tag gold>Mensalista</Tag>}
                      {registration.status === "WAITLISTED" &&
                        registration.priorityTier === "MONTHLY_PRIORITY" && <Tag>Prioridade</Tag>}
                      {registration.promotedAt && <Tag>Promovido</Tag>}
                      {registration.manualOverrideAt && registration.status !== "REMOVED" && (
                        <Tag>Admin</Tag>
                      )}
                    </div>
                  </div>
                </div>
                {extra?.(registration)}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Tag({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return <span className={gold ? darkBadgeGold : darkBadge}>{children}</span>;
}
