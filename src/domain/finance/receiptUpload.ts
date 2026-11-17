export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const RECEIPT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** Declaração sem arquivo — sentinel no DB (sem migration; storageKey nunca aponta para blob). */
export const DECLARATION_WITHOUT_RECEIPT_MIME = "application/x-smv-declaration";
export const DECLARATION_STORAGE_PREFIX = "smv:declaration:";
export const DECLARATION_WITHOUT_RECEIPT_FILENAME = "(sem comprovante)";

export function isDeclarationWithoutReceipt(input: {
  mimeType: string;
  storageKey?: string | null;
}): boolean {
  return (
    input.mimeType === DECLARATION_WITHOUT_RECEIPT_MIME ||
    Boolean(input.storageKey?.startsWith(DECLARATION_STORAGE_PREFIX))
  );
}

export function assertReceiptUploadMeta(input: {
  mimeType: string;
  byteSize: number;
  originalFilename: string;
}): string | null {
  if (!RECEIPT_ALLOWED_MIME.has(input.mimeType)) {
    return "Formato inválido. Envie JPEG, PNG, WebP ou PDF.";
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return "Arquivo vazio.";
  }
  if (input.byteSize > RECEIPT_MAX_BYTES) {
    return "Arquivo maior que 10 MB.";
  }
  if (!input.originalFilename.trim()) {
    return "Nome do arquivo inválido.";
  }
  return null;
}
