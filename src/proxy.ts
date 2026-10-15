import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/constants";

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Checagem otimista: só olha se o cookie existe, sem consultar o banco. A validação
 * real da sessão fica no DAL (src/server/auth/dal.ts), em cada página e Server Action.
 */
export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Fora: rotas de API (autenticação própria, ex.: cron por segredo), assets do Next e
  // arquivos estáticos com extensão.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
