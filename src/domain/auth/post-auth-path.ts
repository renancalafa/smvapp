import type { FinancialAccessMode } from "@/domain/finance/accessPolicy";

/**
 * Destino único após login / troca de senha.
 * Evita redirect aninhado (`/` → `/pagamentos`) no soft-nav do Server Action,
 * que reaproveita o request de `/login` sem pathname de app e quebra o RSC até F5.
 */
export function resolvePostAuthPath(
  mustChangePassword: boolean,
  accessMode: FinancialAccessMode,
): string {
  if (mustChangePassword) return "/change-password";
  if (accessMode === "payment_restricted") {
    return "/pagamentos?aviso=restrito";
  }
  return "/";
}

/**
 * Request ainda “em /login” (ou sem pathname): típico do RSC embutido no
 * Server Action de login. Não usar throw — redirect para /pagamentos.
 */
export function isPostLoginSoftNavPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? pathname).trim();
  return path === "" || path === "/login";
}
