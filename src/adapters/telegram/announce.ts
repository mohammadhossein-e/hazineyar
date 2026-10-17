import { createAnnouncer, createCorrectionAnnouncer } from "../announce";
import { TELEGRAM_CHANNEL } from "../channel";
import { telegramLog, telegramWarn } from "./logger";

/**
 * Group announcements bound to Telegram. The implementation is shared and
 * channel-parameterized; this fixes the channel and the logger, keeping the
 * original `announceExpense` / `announceExpenseCorrection` names for callers
 * such as the admin correction routes.
 */
export const announceExpense = createAnnouncer(
  TELEGRAM_CHANNEL,
  telegramLog,
  telegramWarn,
);

export const announceExpenseCorrection = createCorrectionAnnouncer(
  TELEGRAM_CHANNEL,
  telegramLog,
  telegramWarn,
);

export { buildAnnouncementText } from "../announce";
export type {
  AnnouncementExpense,
  AnnounceOutcome,
  CorrectionAction,
  CorrectionExpense,
  CorrectionOutcome,
} from "../announce";
