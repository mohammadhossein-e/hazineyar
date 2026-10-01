import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { ValidationError } from "@/core/errors";

/** 5 MB is plenty for a phone photo of a paper invoice. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Only plain file names: no separators, no traversal, no hidden names. */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/;

function uploadDir(): string {
  return path.resolve(process.cwd(), config.uploadDir);
}

export function assertAllowedMimeType(mimeType: string): string {
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) {
    throw new ValidationError(
      `فرمت فایل مجاز نیست. فرمت‌های مجاز: ${Object.keys(ALLOWED_MIME_TYPES).join("، ")}`,
    );
  }
  return extension;
}

export function assertWithinSizeLimit(size: number): void {
  if (size <= 0) throw new ValidationError("فایل خالی است");
  if (size > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `حجم فایل نباید بیشتر از ${MAX_UPLOAD_BYTES / (1024 * 1024)} مگابایت باشد`,
    );
  }
}

/**
 * Writes the file under UPLOAD_DIR and returns the stored name (not a full
 * path, so the database stays portable and the serving route can validate it).
 */
export async function saveInvoiceFile(params: {
  buffer: Buffer;
  mimeType: string;
  invoiceNumber?: string;
}): Promise<string> {
  const extension = assertAllowedMimeType(params.mimeType);
  assertWithinSizeLimit(params.buffer.byteLength);

  const prefix = params.invoiceNumber
    ? `${params.invoiceNumber}_`
    : "";
  const filename = `${prefix}${randomUUID()}.${extension}`;

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), params.buffer);

  return filename;
}

/**
 * Reads a stored invoice. The name is validated and the resolved path is
 * re-checked against the upload directory, so `../` or an absolute path can
 * never escape UPLOAD_DIR.
 */
export async function readInvoiceFile(filename: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (!SAFE_FILENAME.test(filename) || filename.includes("..")) {
    throw new ValidationError("نام فایل نامعتبر است");
  }

  const dir = uploadDir();
  const fullPath = path.resolve(dir, filename);

  if (path.dirname(fullPath) !== dir) {
    throw new ValidationError("نام فایل نامعتبر است");
  }

  const extension = path.extname(filename).slice(1).toLowerCase();
  const mimeType = Object.entries(ALLOWED_MIME_TYPES).find(
    ([, ext]) => ext === extension,
  )?.[0];

  if (!mimeType) throw new ValidationError("فرمت فایل مجاز نیست");

  try {
    const buffer = await readFile(fullPath);
    return { buffer, mimeType };
  } catch {
    throw new ValidationError("فایل یافت نشد");
  }
}

/**
 * Deletes a stored invoice, applying the same name validation as the read
 * path so a crafted name can never remove anything outside UPLOAD_DIR.
 * Missing files are fine; anything else is a real problem.
 */
export async function deleteInvoiceFile(filename: string): Promise<void> {
  if (!SAFE_FILENAME.test(filename) || filename.includes("..")) return;

  const dir = uploadDir();
  const fullPath = path.resolve(dir, filename);

  if (path.dirname(fullPath) !== dir) return;

  try {
    await unlink(fullPath);
  } catch (error) {
    // ENOENT means another writer already replaced the file: not an error.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw error;
  }
}
