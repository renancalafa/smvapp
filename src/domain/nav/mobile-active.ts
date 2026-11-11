/** Destaca rota exata ou prefixo (exceto Início). */
export function isNavHrefActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Mais fica ativo em Admin e Conta (itens do sheet). */
export function isMaisNavActive(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/")
  );
}
