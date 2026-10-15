// Importado também pelo proxy: sem dependências de servidor (banco, next/headers).

const isProduction = process.env.NODE_ENV === "production";

/** O prefixo __Host- exige Secure, então só é usado em produção (HTTPS). */
export const SESSION_COOKIE_NAME = isProduction ? "__Host-smv_session" : "smv_session";
export const SESSION_COOKIE_SECURE = isProduction;

/** Duração fixa da sessão, contada a partir do login. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Intervalo mínimo entre atualizações de AuthSession.lastUsedAt. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
