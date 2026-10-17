import { ValidationError } from "@/core/errors";
import type { ChannelConfig } from "./channel";

export type DownloadFn = (
  filePath: string,
  signal?: AbortSignal,
) => Promise<{ buffer: Buffer; contentType: string }>;

/**
 * grammy exposes `getFile` for metadata only, so the bytes come from the plain
 * file endpoint using the `file_path` it hands back. Failures surface as
 * ValidationError so the conversation can re-prompt instead of crashing.
 *
 * `contentType` is the header the file endpoint replied with, reported for
 * logging only and deliberately not used to decide what the file is: both
 * Telegram and Bale answer the file endpoint with `application/octet-stream`
 * for essentially every file, so a header check here rejects valid photos and
 * PDFs. The type is taken from the message instead — see `resolveInvoiceMedia`.
 */
export function createChannelDownload(
  channel: ChannelConfig,
  warn: (message: string, detail?: unknown) => void,
): DownloadFn {
  const endpoint = `${channel.fileBaseUrl}/bot${channel.token}`;

  return async (filePath, signal) => {
    const url = `${endpoint}/${filePath}`;

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      warn(`download failed for ${filePath}: request error`, error);
      throw new ValidationError(
        `دریافت فایل از ${channel.label} ناموفق بود`,
      );
    }

    if (!response.ok) {
      warn(`download failed for ${filePath}: HTTP ${response.status}`);
      throw new ValidationError(
        `دریافت فایل از ${channel.label} ناموفق بود`,
      );
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
  };
}
