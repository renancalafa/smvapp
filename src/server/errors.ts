/** Erro de regra ou de entrada cuja mensagem pode ser mostrada ao usuário. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Concorrência no Modo Pelada: a partida mudou desde a versão que o operador via.
 * `current` é o estado atual para a tela reconciliar (docs/architecture.md).
 */
export class ConflictError extends Error {
  constructor(public readonly current: unknown) {
    super("A partida mudou enquanto você agia. Atualize e tente de novo.");
    this.name = "ConflictError";
  }
}
