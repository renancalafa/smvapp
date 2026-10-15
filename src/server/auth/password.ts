// Hash de senha com scrypt (node:crypto), armazenado como string PHC:
//   $scrypt$ln=17,r=8,p=1$<salt base64>$<hash base64>
// Sem "server-only": também usado por scripts/bootstrap.ts.
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { normalizePassword, PASSWORD_MAX_LENGTH } from "./validation";

const CURRENT = { ln: 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

type ScryptParams = { ln: number; r: number; p: number };

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const N = 2 ** params.ln;
  const options: ScryptOptions = {
    N,
    r: params.r,
    p: params.p,
    // scrypt usa ~128 * N * r bytes; o limite padrão (32 MiB) não comporta ln=17.
    maxmem: 2 * 128 * N * params.r,
  };
  return new Promise((resolve, reject) => {
    scrypt(normalizePassword(password), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function encodeBase64(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer };

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "scrypt") return null;
  const match = /^ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})$/.exec(parts[2]);
  if (!match) return null;
  const params = { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  if (params.ln < 10 || params.ln > 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) {
    return null;
  }
  const salt = Buffer.from(parts[3], "base64");
  const hash = Buffer.from(parts[4], "base64");
  if (salt.length < SALT_LENGTH || hash.length !== KEY_LENGTH) return null;
  return { params, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await deriveKey(password, salt, CURRENT);
  return `$scrypt$ln=${CURRENT.ln},r=${CURRENT.r},p=${CURRENT.p}$${encodeBase64(salt)}$${encodeBase64(hash)}`;
}

/** Falso também para hash ilegível; nunca lança por causa da senha informada. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH * 4) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await deriveKey(password, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.hash);
}

/** Hash gerado com parâmetros diferentes dos atuais: regravar após um login válido. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return (
    !parsed ||
    parsed.params.ln !== CURRENT.ln ||
    parsed.params.r !== CURRENT.r ||
    parsed.params.p !== CURRENT.p
  );
}

let dummyHash: Promise<string> | undefined;

/** Custo equivalente a uma verificação real, para usuário inexistente (evita enumeração por tempo). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

// Sem 0/O, 1/I/L, para ser ditada ou digitada sem ambiguidade.
const TEMPORARY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 16 caracteres (~79 bits) em grupos de 4, ex.: K7QM-2WXR-H9TD-PC4E. */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) group += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
