/** Destinos do submenu Admin (sidebar desktop + sheet Mais no mobile). */
export const ADMIN_SUBNAV = [
  { href: "/admin/players", label: "Jogadores" },
  { href: "/admin/sessions", label: "Sessões" },
  { href: "/admin/agenda", label: "Agenda" },
] as const;

export type AdminSubnavHref = (typeof ADMIN_SUBNAV)[number]["href"];

export function isAdminSectionPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isAdminSubnavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
