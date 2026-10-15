/** Erro de regra ou de entrada cuja mensagem pode ser mostrada ao usuário. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
