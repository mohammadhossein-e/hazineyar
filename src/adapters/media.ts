import type { Api, RawApi } from "grammy";
import type { Message } from "grammy/types";
import { ValidationError } from "@/core/errors";
import { assertAllowedMimeType, assertWithinSizeLimit } from "@/lib/uploads";
import type { DownloadFn } from "./download";

/**
 * Telegram always delivers `message.photo` as JPEG, whatever the sender's
 * device or gallery app produced, and `PhotoSize` carries no mime type at all.
 * Bale mirrors this shape, so the message kind stays the only trustworthy
 * source for a photo on both networks.
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
  /** The mime type the network reported, or `""` when it reported none. */
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
 * The type deliberately does **not** come from the download response: the file
 * endpoint answers with `application/octet-stream` whatever it is serving, so
 * trusting that header rejects perfectly good photos and PDFs.
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

export type MediaToolkit = {
  downloadInvoice(
    api: Api<RawApi>,
    media: InvoiceMedia,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
  downloadInvoiceMedia(
    api: Api<RawApi>,
    message: Message,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
};

/**
 * Builds the invoice downloader for one channel.
 *
 * `trustReportedSize` matters because Bale under-reports `file_size`: a
 * pre-download size check would pass a file that is in fact over the limit. So
 * Bale skips the metadata check and always enforces the limit on the bytes that
 * actually arrived, while Telegram (which reports the size faithfully) rejects
 * an oversized file before spending any bandwidth.
 */
export function createMediaToolkit(deps: {
  downloadFile: DownloadFn;
  log: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  trustReportedSize: boolean;
}): MediaToolkit {
  const { downloadFile, log, warn, trustReportedSize } = deps;

  async function downloadInvoice(
    api: Api<RawApi>,
    media: InvoiceMedia,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    log(`invoice received: ${label(media)}`, {
      mimeType: media.mimeType || "(none reported)",
      size: media.size ?? "(unknown)",
    });

    // The type is checked before a single byte is downloaded, so an unsupported
    // file costs no bandwidth.
    assertAllowedMimeType(media.mimeType);
    log(`invoice type accepted: ${media.mimeType}`);

    if (trustReportedSize && media.size !== undefined) {
      assertWithinSizeLimit(media.size);
      log(`invoice size accepted: ${media.size} bytes`);
    }

    const file = await api.getFile(media.fileId);
    if (!file.file_path) {
      warn(`invoice rejected: getFile returned no file_path for ${media.fileId}`);
      throw new ValidationError("فایل یافت نشد");
    }
    log(`invoice download: ${file.file_path}`);

    const { buffer, contentType } = await downloadFile(file.file_path);
    log(`invoice downloaded: ${buffer.byteLength} bytes`, {
      contentType: contentType || "(none reported)",
      note: "content-type is informational only; the type comes from the message",
    });

    // Always enforced on the real bytes: this is the check Bale depends on.
    assertWithinSizeLimit(buffer.byteLength);

    return { buffer, mimeType: media.mimeType };
  }

  async function downloadInvoiceMedia(
    api: Api<RawApi>,
    message: Message,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const media = resolveInvoiceMedia(message);
    if (!media) {
      warn("invoice rejected: the message has no photo and no document");
      throw new ValidationError("فایلی ارسال نشده است");
    }
    return downloadInvoice(api, media);
  }

  return { downloadInvoice, downloadInvoiceMedia };
}
