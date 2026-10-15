// Regras de entrada da autenticação. Sem "server-only": também usado por scripts/.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Forma armazenada em User.username (o banco exige minúsculas). */
export function normalizeUsername(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

/** A senha é comparada e armazenada nesta forma, para que variantes Unicode coincidam. */
export function normalizePassword(raw: string): string {
  return raw.normalize("NFKC");
}

/** Retorna a mensagem de erro, ou null se a nova senha é aceitável. */
export function validateNewPassword(
  password: string,
  context: { username: string; currentPassword?: string },
): string | null {
  const normalized = normalizePassword(password);
  if (normalized.length < PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (normalized.length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  if (normalized.trim().length === 0) {
    return "A senha não pode ser só espaços.";
  }
  if (normalized.toLowerCase() === context.username.toLowerCase()) {
    return "A senha não pode ser igual ao usuário.";
  }
  if (
    context.currentPassword !== undefined &&
    normalized === normalizePassword(context.currentPassword)
  ) {
    return "A nova senha precisa ser diferente da atual.";
  }
  return null;
}

/** Campo de texto de um FormData; ausente ou arquivo vira "". */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
