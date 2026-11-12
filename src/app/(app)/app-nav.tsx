"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  ADMIN_SUBNAV,
  isAdminSectionPath,
  isAdminSubnavActive,
} from "@/domain/nav/admin-subnav";
import { isMaisNavActive, isNavHrefActive } from "@/domain/nav/mobile-active";
import { MobileMoreSheet } from "./mobile-more-sheet";

export { isMaisNavActive, isNavHrefActive } from "@/domain/nav/mobile-active";

export type NavIcon = "home" | "live" | "rodada" | "historico" | "stats" | "admin" | "account" | "more";
export type NavItem = { href: string; label: string; icon: NavIcon };

const ICON_PATHS: Record<NavIcon, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  live: "M12 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-5.3-1.5a5.3 5.3 0 0 1 10.6 0m-13.2 0a8.2 8.2 0 0 1 16.4 0",
  rodada: "M8 21h8M12 17v4M7 4h10l1 5H6zm1 5v3a4 4 0 0 0 8 0V9",
  historico: "M4 5h16M4 12h16M4 19h10",
  stats: "M4 19V9m5 10V5m5 14v-6m5 6V3",
  admin: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zm0 6v4m0 3h.01",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function Icon({ name, className = "size-6 shrink-0" }: { name: NavIcon; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
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

/** Barra inferior fixa (5 itens), só no celular. */
export function BottomNav({
  items,
  showAdminInMore,
}: {
  /** Início, Rodada/Ao Vivo, Histórico, Estatísticas — Mais é local. */
  items: NavItem[];
  showAdminInMore: boolean;
}) {
  const pathname = useHydratedPathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  return (
    <>
      <MobileMoreSheet
        open={moreOpen}
        onClose={closeMore}
        showAdmin={showAdminInMore}
        returnFocusRef={moreButtonRef}
      />
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-smv-navy/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const active = pathname !== null && isNavHrefActive(pathname, item.href);
            return (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  {...(active ? { "aria-current": "page" as const } : {})}
                  className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10px] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold focus-visible:ring-inset sm:text-xs ${
                    active ? "text-smv-gold-bright" : "text-white/55 active:text-smv-cream"
                  }`}
                >
                  <Icon name={item.icon} className="size-5 shrink-0 sm:size-6" />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              ref={moreButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              className={`flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10px] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold focus-visible:ring-inset sm:text-xs ${
                pathname !== null && (moreOpen || isMaisNavActive(pathname))
                  ? "text-smv-gold-bright"
                  : "text-white/55 active:text-smv-cream"
              }`}
            >
              <Icon name="more" className="size-5 shrink-0 sm:size-6" />
              <span className="max-w-full truncate">Mais</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function AdminSideNavGroup({
  pathname,
  sectionActive,
}: {
  pathname: string | null;
  sectionActive: boolean;
}) {
  // Remount via key when entering/leaving admin routes so initial open tracks the section
  // without setState-in-effect (stays expanded on admin child routes).
  const [open, setOpen] = useState(sectionActive);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
          sectionActive
            ? "bg-smv-gold/10 text-smv-gold-bright"
            : "text-white/65 hover:bg-white/8 hover:text-smv-cream"
        }`}
      >
        <Icon name="admin" />
        <span className="flex-1 text-left">Admin</span>
        <span className={`text-xs transition ${open ? "rotate-90" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5 border-l border-white/10 py-0.5 pl-2 ml-5">
          {ADMIN_SUBNAV.map((item) => {
            const active = pathname !== null && isAdminSubnavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  {...(active ? { "aria-current": "page" as const } : {})}
                  className={`flex min-h-10 items-center rounded-lg px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                    active
                      ? "bg-smv-gold/15 font-medium text-smv-gold-bright ring-1 ring-smv-gold/35"
                      : "font-normal text-white/55 hover:bg-white/8 hover:text-smv-cream"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function SideNavLink({ item, pathname }: { item: NavItem; pathname: string | null }) {
  const active = pathname !== null && isNavHrefActive(pathname, item.href);
  return (
    <li>
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
}

/** Lista lateral, só no desktop. */
export function SideNav({
  items,
  showAdmin = false,
}: {
  items: NavItem[];
  /** Submenu Admin (só ADMIN), entre Estatísticas e Conta. */
  showAdmin?: boolean;
}) {
  const pathname = useHydratedPathname();
  const account = items.find((item) => item.href === "/account");
  const primary = items.filter((item) => item.href !== "/account");
  return (
    <nav aria-label="Navegação principal">
      <ul className="flex flex-col gap-1">
        {primary.map((item) => (
          <SideNavLink key={item.href} item={item} pathname={pathname} />
        ))}
        {showAdmin ? (
          <AdminSideNavGroup
            key={pathname !== null && isAdminSectionPath(pathname) ? "admin-in" : "admin-out"}
            pathname={pathname}
            sectionActive={pathname !== null && isAdminSectionPath(pathname)}
          />
        ) : null}
        {account ? <SideNavLink item={account} pathname={pathname} /> : null}
      </ul>
    </nav>
  );
}
