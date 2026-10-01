import type { Api, RawApi } from "grammy";
import type { Message } from "grammy/types";
import { ValidationError } from "@/core/errors";
import { assertAllowedMimeType, assertWithinSizeLimit } from "@/lib/uploads";
import { downloadTelegramFile } from "./download";
import { telegramLog, telegramWarn } from "./logger";

/**
 * Telegram always delivers `message.photo` as JPEG, whatever the sender's
 * device or gallery app produced, and `PhotoSize` carries no mime type at all.
 * The message kind is therefore the only trustworthy source for a photo.
 */
const PHOTO_MIME_TYPE = "image/jpeg";

/** Last-resort type for a document that arrives without `mime_type`. */
const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: PHOTO_MIME_TYPE,
  jpeg: PHOTO_MIME_TYPE,
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export type InvoiceMedia = {
  fileId: string;
  /** The mime type Telegram reported, or `""` when it reported none. */
  mimeType: string;
  fileName?: string;
  size?: number;
  source: "photo" | "document";
};

/**
 * A photo is sent in several sizes, from a thumbnail up to the original, and
 * the array is always ordered small to large, so the last entry is the one
 * worth downloading.
 */
function largestPhoto(message: Message) {
  const photos = message.photo ?? [];
  return photos[photos.length - 1];
}

function mimeFromName(name: string | undefined): string {
  const extension = name?.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_TYPES[extension] ?? "";
}

/**
 * Describes the invoice a user attached, reading the type from the message
 * itself. Returns `null` when the message carries no photo and no document.
 *
 * The type deliberately does **not** come from the download response: the
 * Telegram file endpoint answers with `application/octet-stream` whatever it is
 * serving, so trusting that header rejects perfectly good photos and PDFs.
 */
export function resolveInvoiceMedia(message: Message): InvoiceMedia | null {
  const photo = largestPhoto(message);
  if (photo) {
    return {
      fileId: photo.file_id,
      mimeType: PHOTO_MIME_TYPE,
      size: photo.file_size,
      source: "photo",
    };
  }

  const document = message.document;
  if (document) {
    return {
      fileId: document.file_id,
      mimeType: (
        document.mime_type ?? mimeFromName(document.file_name)
      ).toLowerCase(),
      fileName: document.file_name,
      size: document.file_size,
      source: "document",
    };
  }

  return null;
}

/** Whether the message is a candidate for the invoice step at all. */
export function hasInvoiceMedia(message: Message | undefined): boolean {
  if (!message) return false;
  return resolveInvoiceMedia(message) !== null;
}

function label(media: InvoiceMedia): string {
  return `${media.source} ${media.fileName ?? media.fileId}`;
}

/**
 * Turns an attached invoice into bytes, validating at every step and logging
 * which one ran, so a rejection in the bot is traceable on the server instead
 * of showing up only as a message to the user.
 *
 * Throws a `ValidationError` with a user-facing reason, which the conversation
 * turns into a re-prompt.
 */
export async function downloadInvoiceMedia(
  api: Api<RawApi>,
  message: Message,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const media = resolveInvoiceMedia(message);
  if (!media) {
    telegramWarn("invoice rejected: the message has no photo and no document");
    throw new ValidationError("فایلی ارسال نشده است");
  }
  telegramLog(`invoice received: ${label(media)}`, {
    mimeType: media.mimeType || "(none reported)",
    size: media.size ?? "(unknown)",
  });

  // The type is checked before a single byte is downloaded, so an unsupported
  // file costs no bandwidth.
  assertAllowedMimeType(media.mimeType);
  telegramLog(`invoice type accepted: ${media.mimeType}`);

  if (media.size !== undefined) {
    assertWithinSizeLimit(media.size);
    telegramLog(`invoice size accepted: ${media.size} bytes`);
  }

  const file = await api.getFile(media.fileId);
  if (!file.file_path) {
    telegramWarn(`invoice rejected: getFile returned no file_path for ${media.fileId}`);
    throw new ValidationError("فایل یافت نشد");
  }
  telegramLog(`invoice download: ${file.file_path}`);

  const { buffer, contentType } = await downloadTelegramFile(file.file_path);
  telegramLog(`invoice downloaded: ${buffer.byteLength} bytes`, {
    contentType: contentType || "(none reported)",
    note: "content-type is informational only; the type comes from the message",
  });

  assertWithinSizeLimit(buffer.byteLength);

  return { buffer, mimeType: media.mimeType };
}
