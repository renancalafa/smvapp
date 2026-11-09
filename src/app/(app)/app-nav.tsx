"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

export type NavIcon = "home" | "live" | "stats" | "admin" | "account";
export type NavItem = { href: string; label: string; icon: NavIcon };

const ICON_PATHS: Record<NavIcon, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  live: "M12 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-5.3-1.5a5.3 5.3 0 0 1 10.6 0m-13.2 0a8.2 8.2 0 0 1 16.4 0",
  stats: "M4 19V9m5 10V5m5 14v-6m5 6V3",
  admin: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zm0 6v4m0 3h.01",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
};

function Icon({ name }: { name: NavIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-6 shrink-0"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * usePathname() can disagree with the SSR markup on the first client paint
 * (soft-nav restore, trailing-slash, etc.), which marked active Link className /
 * aria-current differently and triggered a hydration mismatch at BottomNav.
 * Gate active styles until after mount so server HTML and the hydrated tree match;
 * client navigations still update via usePathname once mounted.
 */
function useHydratedPathname(): string | null {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return hydrated ? pathname : null;
}

/** Barra inferior fixa, só no celular. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = useHydratedPathname();
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-smv-navy/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = pathname !== null && isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                {...(active ? { "aria-current": "page" as const } : {})}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold focus-visible:ring-inset ${
                  active ? "text-smv-gold-bright" : "text-white/55 active:text-smv-cream"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Lista lateral, só no desktop. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = useHydratedPathname();
  return (
    <nav aria-label="Navegação principal">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname !== null && isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                {...(active ? { "aria-current": "page" as const } : {})}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                  active
                    ? "bg-smv-gold/15 text-smv-gold-bright ring-1 ring-smv-gold/35"
                    : "text-white/65 hover:bg-white/8 hover:text-smv-cream"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
