import { createMediaToolkit } from "../media";
import { downloadTelegramFile } from "./download";
import { telegramLog, telegramWarn } from "./logger";

/**
 * Telegram binds the shared media toolkit to its own downloader and logger.
 * Telegram reports file sizes faithfully, so the cheap pre-download size check
 * stays on.
 */
const toolkit = createMediaToolkit({
  downloadFile: downloadTelegramFile,
  log: telegramLog,
  warn: telegramWarn,
  trustReportedSize: true,
});

export const downloadInvoice = toolkit.downloadInvoice;
export const downloadInvoiceMedia = toolkit.downloadInvoiceMedia;

export {
  hasInvoiceMedia,
  resolveInvoiceMedia,
  type InvoiceMedia,
} from "../media";
