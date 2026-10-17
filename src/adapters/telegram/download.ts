import { TELEGRAM_CHANNEL } from "../channel";
import { createChannelDownload } from "../download";
import { telegramWarn } from "./logger";

/**
 * Telegram's file downloader. The endpoint/paths live in the shared
 * `createChannelDownload`; this module only fixes the channel and the logger,
 * keeping the original `downloadTelegramFile` import path intact.
 */
export const downloadTelegramFile = createChannelDownload(
  TELEGRAM_CHANNEL,
  telegramWarn,
);
