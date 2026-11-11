import { jerseyForPosition, type TeamJersey } from "@/domain/team/colors";

type TeamBadgeProps = {
  name: string;
  color: string | null;
  /** Preferir posição quando conhecida (SessionTeam.initialQueuePosition / DrawTeam.position). */
  position?: number | null;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
};

function resolveJersey(props: TeamBadgeProps): TeamJersey | null {
  const byPosition = jerseyForPosition(props.position ?? null);
  if (byPosition) return byPosition;
  return null;
}

/** Badge circular da camisa + rótulo opcional (Branco/Azul/…). */
export function TeamBadge({
  name,
  color,
  position = null,
  size = "sm",
  showLabel = true,
  className = "",
}: TeamBadgeProps) {
  const jersey = resolveJersey({ name, color, position });
  const hex = jersey?.hex ?? color ?? "#C9A227";
  const ring = jersey?.ring ?? "rgba(255,255,255,0.35)";
  const label = jersey?.name ?? name;
  const dim = size === "md" ? "size-4" : "size-3";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className={`${dim} shrink-0 rounded-full`}
        style={{ backgroundColor: hex, boxShadow: `inset 0 0 0 1px ${ring}` }}
        aria-hidden
      />
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}
