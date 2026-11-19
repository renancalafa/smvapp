import { isAdminSectionPath } from "./admin-subnav";

/** Destaca rota exata ou prefixo (exceto Início). */
export function isNavHrefActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Mais fica ativo em Admin, Conta e Níveis (itens do sheet). */
export function isMaisNavActive(pathname: string): boolean {
  return (
    isAdminSectionPath(pathname) ||
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/niveis" ||
    pathname.startsWith("/niveis/")
  );
}
