"use client";

import { usePathname } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { BottomNav, SideNav, type NavIcon, type NavItem } from "./app-nav";

type NightSlot = { href: "/rodada" | "/live"; label: "Rodada" | "Ao Vivo"; icon: NavIcon };

function withNightSlot(items: NavItem[], night: NightSlot): NavItem[] {
  return items.map((item) =>
    item.href === "/rodada" || item.href === "/live"
      ? { href: night.href, label: night.label, icon: night.icon }
      : item,
  );
}

async function fetchNightSlot(): Promise<NightSlot | null> {
  try {
    const response = await fetch("/api/night-nav", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { href?: string; label?: string };
    if (data.href !== "/live" && data.href !== "/rodada") return null;
    if (data.label !== "Ao Vivo" && data.label !== "Rodada") return null;
    return {
      href: data.href,
      label: data.label,
      icon: data.href === "/live" ? "live" : "rodada",
    };
  } catch {
    return null;
  }
}

/**
 * Mantém o slot exclusivo Rodada/Ao Vivo alinhado ao servidor após sorteio,
 * invalidação e encerramento — o layout RSC sozinho não reexecuta em soft-nav.
 */
function useLiveNightSlot(initial: NightSlot): NightSlot {
  const pathname = usePathname();
  const [night, setNight] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: NightSlot | null) => {
      if (cancelled || !next) return;
      startTransition(() => {
        setNight(next);
      });
    };

    void fetchNightSlot().then(apply);

    const onFocus = () => {
      void fetchNightSlot().then(apply);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname]);

  return night;
}

export function NightAwareBottomNav({
  items,
  initialNight,
  showAdminInMore,
}: {
  items: NavItem[];
  initialNight: NightSlot;
  showAdminInMore: boolean;
}) {
  const night = useLiveNightSlot(initialNight);
  return <BottomNav items={withNightSlot(items, night)} showAdminInMore={showAdminInMore} />;
}

export function NightAwareSideNav({
  items,
  initialNight,
}: {
  items: NavItem[];
  initialNight: NightSlot;
}) {
  const night = useLiveNightSlot(initialNight);
  return <SideNav items={withNightSlot(items, night)} />;
}
