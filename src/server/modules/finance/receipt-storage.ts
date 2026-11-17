import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  assertSafeReceiptStorageKey,
  buildReceiptStorageKey,
  resolveReceiptStorageMode,
  resolveS3ReceiptStorageConfig,
  type S3ReceiptStorageConfig,
} from "@/domain/finance/receiptStorageConfig";
import {
  assertReceiptUploadMeta,
  RECEIPT_ALLOWED_MIME,
  RECEIPT_MAX_BYTES,
} from "@/domain/finance/receiptUpload";
import { UserFacingError } from "@/server/errors";

export { RECEIPT_ALLOWED_MIME, RECEIPT_MAX_BYTES };

export type StoredReceiptObject = {
  storageKey: string;
  contentSha256: string;
  byteSize: number;
  mimeType: string;
};

/** Adapter injetável para testes (mock S3 / memória). */
export type ReceiptObjectStore = {
  putObject(input: {
    storageKey: string;
    bytes: Buffer;
    mimeType: string;
  }): Promise<void>;
  getObject(storageKey: string): Promise<Buffer>;
};

let testStoreOverride: ReceiptObjectStore | null = null;
let cachedS3: { fingerprint: string; client: S3Client; bucket: string } | null = null;

/** Somente scripts de teste. Não usar em runtime de produção. */
export function setReceiptObjectStoreForTests(store: ReceiptObjectStore | null): void {
  testStoreOverride = store;
  if (!store) cachedS3 = null;
}

function resolveStorageRoot(): string {
  const configured = process.env.SMV_RECEIPT_STORAGE_DIR?.trim();
  if (configured) return path.resolve(/*turbopackIgnore: true*/ configured);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "receipts");
}

function configError(message: string): never {
  throw new UserFacingError(message);
}

function resolveModeOrThrow(): "local" | "s3" {
  const resolved = resolveReceiptStorageMode(process.env);
  if (!resolved.ok) configError(resolved.error.message);
  return resolved.mode;
}

function createS3Client(config: S3ReceiptStorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Path-style é o mais previsível com endpoints custom (R2).
    forcePathStyle: true,
  };
  return new S3Client(clientConfig);
}

function getS3BucketAndClient(): { client: S3Client; bucket: string } {
  const resolved = resolveS3ReceiptStorageConfig(process.env);
  if (!resolved.ok) configError(resolved.error.message);
  const { config } = resolved;
  const fingerprint = [
    config.endpoint,
    config.bucket,
    config.region,
    config.accessKeyId,
  ].join("|");
  if (!cachedS3 || cachedS3.fingerprint !== fingerprint) {
    cachedS3 = {
      fingerprint,
      client: createS3Client(config),
      bucket: config.bucket,
    };
  }
  return { client: cachedS3.client, bucket: cachedS3.bucket };
}

function mapS3Failure(error: unknown, operation: "upload" | "download"): never {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: string }).name)
      : "";
  const httpStatus =
    error && typeof error === "object" && "$metadata" in error
      ? Number(
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode ?? 0,
        )
      : 0;
  const code =
    error && typeof error === "object" && "Code" in error
      ? String((error as { Code?: string }).Code)
      : error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";

  if (
    operation === "download" &&
    (name === "NoSuchKey" ||
      name === "NotFound" ||
      code === "NoSuchKey" ||
      code === "NotFound" ||
      httpStatus === 404)
  ) {
    throw new UserFacingError("Comprovante não encontrado no storage.");
  }

  if (
    name === "PreconditionFailed" ||
    code === "PreconditionFailed" ||
    httpStatus === 412
  ) {
    throw new UserFacingError("Falha ao gravar comprovante (objeto já existe). Tente novamente.");
  }

  if (
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch" ||
    name === "AccessDenied" ||
    code === "InvalidAccessKeyId" ||
    code === "SignatureDoesNotMatch" ||
    code === "AccessDenied" ||
    httpStatus === 403
  ) {
    throw new UserFacingError(
      "Falha de autenticação no storage de comprovantes. Verifique as credenciais R2.",
    );
  }

  throw new UserFacingError(
    operation === "upload"
      ? "Falha ao enviar comprovante ao storage. Tente novamente."
      : "Falha ao ler comprovante do storage. Tente novamente.",
  );
}

async function putLocal(storageKey: string, bytes: Buffer): Promise<void> {
  const root = resolveStorageRoot();
  const fullPath = path.join(/*turbopackIgnore: true*/ root, storageKey);
  await mkdir(path.dirname(/*turbopackIgnore: true*/ fullPath), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ fullPath, bytes, { flag: "wx" });
}

async function getLocal(storageKey: string): Promise<Buffer> {
  const fullPath = path.join(/*turbopackIgnore: true*/ resolveStorageRoot(), storageKey);
  try {
    return await readFile(/*turbopackIgnore: true*/ fullPath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") {
      throw new UserFacingError("Comprovante não encontrado no storage.");
    }
    throw new UserFacingError("Falha ao ler comprovante do storage. Tente novamente.");
  }
}

async function putS3(storageKey: string, bytes: Buffer, mimeType: string): Promise<void> {
  const { client, bucket } = getS3BucketAndClient();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: mimeType,
        ContentLength: bytes.byteLength,
        // Impede sobrescrita acidental se a mesma chave já existir.
        IfNoneMatch: "*",
        // Objeto privado; downloads só via API autenticada da app.
        CacheControl: "private, no-store",
      }),
    );
  } catch (error) {
    mapS3Failure(error, "upload");
  }
}

async function getS3(storageKey: string): Promise<Buffer> {
  const { client, bucket } = getS3BucketAndClient();
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }),
    );
    const body = result.Body;
    if (!body) {
      throw new UserFacingError("Comprovante não encontrado no storage.");
    }
    const bytes = Buffer.from(await body.transformToByteArray());
    return bytes;
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    mapS3Failure(error, "download");
  }
}

function resolveStore(): ReceiptObjectStore {
  if (testStoreOverride) return testStoreOverride;

  const mode = resolveModeOrThrow();
  if (mode === "local") {
    return {
      putObject: async ({ storageKey, bytes }) => putLocal(storageKey, bytes),
      getObject: async (storageKey) => getLocal(storageKey),
    };
  }

  // mode === "s3" — nunca cai para filesystem local.
  return {
    putObject: async ({ storageKey, bytes, mimeType }) => putS3(storageKey, bytes, mimeType),
    getObject: async (storageKey) => getS3(storageKey),
  };
}

export function validateReceiptUpload(input: {
  mimeType: string;
  byteSize: number;
  originalFilename: string;
}): void {
  const error = assertReceiptUploadMeta(input);
  if (error) throw new UserFacingError(error);
}

function assertRuntimeStorageConfigured(): void {
  // Adapter de teste bypassa env real (não há fallback silencioso para disco).
  if (testStoreOverride) return;
  const mode = resolveModeOrThrow();
  if (mode === "s3") {
    const s3 = resolveS3ReceiptStorageConfig(process.env);
    if (!s3.ok) configError(s3.error.message);
  }
}

export async function storeReceiptObject(input: {
  groupId: string;
  chargeId: string;
  mimeType: string;
  originalFilename: string;
  bytes: Buffer;
}): Promise<StoredReceiptObject> {
  // Valida modo/config cedo (fail-closed) antes de tocar no arquivo.
  assertRuntimeStorageConfigured();

  validateReceiptUpload({
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    originalFilename: input.originalFilename,
  });

  const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storageKey = buildReceiptStorageKey({
    groupId: input.groupId,
    chargeId: input.chargeId,
    objectId: randomUUID(),
    mimeType: input.mimeType,
  });

  const store = resolveStore();
  try {
    await store.putObject({
      storageKey,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("Falha ao enviar comprovante ao storage. Tente novamente.");
  }

  return {
    storageKey,
    contentSha256,
    byteSize: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

export async function readReceiptObject(storageKey: string): Promise<Buffer> {
  assertRuntimeStorageConfigured();

  const keyError = assertSafeReceiptStorageKey(storageKey);
  if (keyError) throw new UserFacingError(keyError);

  const store = resolveStore();
  try {
    return await store.getObject(storageKey);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("Falha ao ler comprovante do storage. Tente novamente.");
  }
}
