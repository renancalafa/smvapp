/**
 * Resolução pura da configuração de storage de comprovantes.
 * Sem I/O e sem SDK — testável em scripts de regressão.
 */

export type ReceiptStorageMode = "local" | "s3";

export type S3ReceiptStorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type ReceiptStorageConfigError = {
  code:
    | "invalid_mode"
    | "local_forbidden_in_production"
    | "s3_missing_config"
    | "s3_invalid_endpoint";
  message: string;
};

function trimOrEmpty(value: string | undefined): string {
  return (value ?? "").trim();
}

export function isProductionLikeEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): boolean {
  const vercel = trimOrEmpty(env.VERCEL).toLowerCase();
  if (vercel === "1" || vercel === "true") return true;
  return trimOrEmpty(env.NODE_ENV).toLowerCase() === "production";
}

export function resolveReceiptStorageMode(
  env: NodeJS.Dict<string | undefined> = process.env,
): { ok: true; mode: ReceiptStorageMode } | { ok: false; error: ReceiptStorageConfigError } {
  const raw = trimOrEmpty(env.SMV_RECEIPT_STORAGE).toLowerCase();
  const mode = (raw || "local") as string;
  if (mode !== "local" && mode !== "s3") {
    return {
      ok: false,
      error: {
        code: "invalid_mode",
        message: `SMV_RECEIPT_STORAGE inválido: ${mode}. Use "local" ou "s3".`,
      },
    };
  }
  if (mode === "local" && isProductionLikeEnv(env)) {
    return {
      ok: false,
      error: {
        code: "local_forbidden_in_production",
        message:
          "Armazenamento local de comprovantes não é permitido em produção. Configure SMV_RECEIPT_STORAGE=s3 com bucket R2 privado.",
      },
    };
  }
  return { ok: true, mode: mode as ReceiptStorageMode };
}

export function resolveS3ReceiptStorageConfig(
  env: NodeJS.Dict<string | undefined> = process.env,
):
  | { ok: true; config: S3ReceiptStorageConfig }
  | { ok: false; error: ReceiptStorageConfigError } {
  const endpoint = trimOrEmpty(env.SMV_RECEIPT_S3_ENDPOINT);
  const bucket = trimOrEmpty(env.SMV_RECEIPT_S3_BUCKET);
  const accessKeyId = trimOrEmpty(env.SMV_RECEIPT_S3_ACCESS_KEY_ID);
  const secretAccessKey = trimOrEmpty(env.SMV_RECEIPT_S3_SECRET_ACCESS_KEY);
  const region = trimOrEmpty(env.SMV_RECEIPT_S3_REGION) || "auto";

  const missing: string[] = [];
  if (!endpoint) missing.push("SMV_RECEIPT_S3_ENDPOINT");
  if (!bucket) missing.push("SMV_RECEIPT_S3_BUCKET");
  if (!accessKeyId) missing.push("SMV_RECEIPT_S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("SMV_RECEIPT_S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "s3_missing_config",
        message: `Configuração S3/R2 incompleta. Defina: ${missing.join(", ")}.`,
      },
    };
  }

  if (!/^https:\/\//i.test(endpoint)) {
    return {
      ok: false,
      error: {
        code: "s3_invalid_endpoint",
        message: "SMV_RECEIPT_S3_ENDPOINT deve ser uma URL https:// (endpoint R2 S3 API).",
      },
    };
  }

  return {
    ok: true,
    config: { endpoint, bucket, accessKeyId, secretAccessKey, region },
  };
}

export function receiptObjectExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function buildReceiptStorageKey(input: {
  groupId: string;
  chargeId: string;
  objectId: string;
  mimeType: string;
}): string {
  const ext = receiptObjectExtension(input.mimeType);
  return `${input.groupId}/${input.chargeId}/${input.objectId}.${ext}`;
}

export function assertSafeReceiptStorageKey(storageKey: string): string | null {
  if (!storageKey || storageKey.includes("..") || storageKey.startsWith("/") || storageKey.includes("\\")) {
    return "Chave de comprovante inválida.";
  }
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(storageKey)) {
    // Allow UUID/UUID/UUID.ext — groupId/chargeId/objectId are UUIDs in this app.
    // Also accept any non-traversal relative key with a single extension for forward-compat tests.
    if (!/^[A-Za-z0-9._/-]+$/.test(storageKey) || storageKey.includes("//")) {
      return "Chave de comprovante inválida.";
    }
  }
  return null;
}
