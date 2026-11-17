"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { id: "sessoes", label: "Sessões" },
  { id: "financeiro", label: "Financeiro" },
] as const;

export type ConfigTabId = (typeof TABS)[number]["id"];

export function ConfigTabs({ active }: { active: ConfigTabId }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="flex gap-1 rounded-xl bg-black/25 p-1 ring-1 ring-white/10">
      {TABS.map((tab) => {
        const selected = active === tab.id;
        const href = `${pathname}?tab=${tab.id}`;
        return (
          <Link
            key={tab.id}
            href={href}
            className={`flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-colors ${
              selected
                ? "bg-smv-gold/20 text-smv-gold-bright ring-1 ring-smv-gold/40"
                : "text-white/60 hover:text-smv-cream"
            }`}
            aria-current={selected ? "page" : undefined}
            replace
          >
            {tab.label}
          </Link>
        );
      })}
      {/* keep unused searchParams referenced for RSC hydration consistency */}
      <span className="hidden">{searchParams.get("tab")}</span>
    </div>
  );
}
