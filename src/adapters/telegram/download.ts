import { config } from "@/lib/config";
import { ValidationError } from "@/core/errors";
import { telegramWarn } from "./logger";

const FILE_ENDPOINT = "https://api.telegram.org/file";

/**
 * grammy exposes `getFile` for metadata only, so the bytes come from the plain
 * file endpoint using the `file_path` it hands back. Failures surface as
 * ValidationError so the conversation can re-prompt instead of crashing.
 *
 * `contentType` is the header the file endpoint replied with, reported for
 * logging only and deliberately not used to decide what the file is: Telegram
 * answers the file endpoint with `application/octet-stream` for essentially
 * every file, so a header check here rejects valid photos and PDFs. The type
 * is taken from the message instead — see `resolveInvoiceMedia`.
 */
export async function downloadTelegramFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = `${FILE_ENDPOINT}/bot${config.telegramBotToken}/${filePath}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    telegramWarn(`download failed for ${filePath}: request error`, error);
    throw new ValidationError("دریافت فایل از تلگرام ناموفق بود");
  }

  if (!response.ok) {
    telegramWarn(`download failed for ${filePath}: HTTP ${response.status}`);
    throw new ValidationError("دریافت فایل از تلگرام ناموفق بود");
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
}
