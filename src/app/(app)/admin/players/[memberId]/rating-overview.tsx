import type { ReactNode } from "react";
import {
  darkBadgeGold,
  darkMutedXs,
  darkPanel,
  darkSectionLabel,
  darkStat,
} from "@/lib/ui/dark-surfaces";
import { formatRatingValue } from "@/app/(app)/niveis/format";

function stars(value: number): string {
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

function AttributeCard({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number | null;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`${emphasize ? "bg-smv-gold/12 ring-1 ring-smv-gold/35" : darkStat} flex min-h-[5.25rem] flex-col justify-center gap-1 px-3 py-2.5 text-left`}
    >
      <p
        className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${
          emphasize ? "text-smv-gold-bright" : "text-white/55"
        }`}
      >
        {label}
      </p>
      {value == null ? (
        <p className="text-base font-semibold text-white/45">Sem nota</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums text-smv-cream">{value}</p>
          <p className={darkMutedXs} title={formatRatingValue(value)}>
            {stars(value)}
          </p>
        </>
      )}
    </div>
  );
}

function preferredRoleLabel(
  role: "ATTACKER" | "DEFENDER" | "VERSATILE" | null,
): string {
  if (role === "ATTACKER") return "Atacante (A)";
  if (role === "DEFENDER") return "Defensor (D)";
  if (role === "VERSATILE") return "Versátil (V)";
  return "Não definido";
}

export function RatingOverview({
  baseRating,
  attackRating,
  defenseRating,
  physicalRating,
  preferredRole,
  editAction,
}: {
  baseRating: number;
  attackRating: number | null;
  defenseRating: number | null;
  physicalRating: number | null;
  preferredRole: "ATTACKER" | "DEFENDER" | "VERSATILE" | null;
  editAction: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={darkSectionLabel}>Avaliação do jogador</h2>
        <div className="flex flex-wrap gap-2">{editAction}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AttributeCard label="Overall" value={baseRating} emphasize />
        <AttributeCard label="Ataque" value={attackRating} />
        <AttributeCard label="Defesa" value={defenseRating} />
        <AttributeCard label="Físico" value={physicalRating} />
      </div>

      <div className={`${darkPanel} flex flex-wrap items-center justify-between gap-3 px-3 py-3`}>
        <div className="min-w-0">
          <p className={darkMutedXs}>Papel preferido no campo</p>
          <p className="mt-0.5 text-sm font-semibold text-smv-cream">
            {preferredRoleLabel(preferredRole)}
          </p>
        </div>
        {preferredRole ? (
          <span className={darkBadgeGold}>
            {preferredRole === "ATTACKER" ? "A" : preferredRole === "DEFENDER" ? "D" : "V"}
          </span>
        ) : null}
      </div>
    </section>
  );
}
