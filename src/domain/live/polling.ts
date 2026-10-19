/** Fase de polling do espectador Ao Vivo (sem I/O). */
export type SpectatorPollPhase = "active" | "waiting" | "idle" | "ended";

/** Intervalo adaptativo; null = parar (sessão encerrada). */
export function pollIntervalMs(phase: SpectatorPollPhase): number | null {
  switch (phase) {
    case "active":
      return 5_000;
    case "waiting":
      return 10_000;
    case "idle":
      return 30_000;
    case "ended":
      return null;
  }
}

/** Aba oculta: suspende; ao voltar, o cliente faz refresh imediato. */
export function shouldPollWhileVisible(documentHidden: boolean): boolean {
  return !documentHidden;
}

/**
 * Normaliza ETag / If-None-Match (aspas opcionais, W/ fraco ignorado).
 * Retorna null se vazio.
 */
export function normalizeRevisionToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") return null;
  const withoutWeak = trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
  if (withoutWeak.startsWith('"') && withoutWeak.endsWith('"') && withoutWeak.length >= 2) {
    return withoutWeak.slice(1, -1);
  }
  return withoutWeak;
}

export function revisionsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeRevisionToken(a);
  const right = normalizeRevisionToken(b);
  if (!left || !right) return false;
  return left === right;
}

export function formatEtag(revision: string): string {
  return `"${revision}"`;
}
