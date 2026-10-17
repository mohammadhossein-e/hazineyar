import { config } from "@/lib/config";
import { createChannelLogger } from "../logger";

/**
 * Telegram-flavoured logger. The implementation lives in the shared
 * `createChannelLogger`; this module only fixes the prefix and the secrets so
 * every existing `telegramLog/Warn/Error` import keeps working unchanged.
 */
const logger = createChannelLogger("telegram", config.secretTokens);

export const telegramLog = logger.log;
export const telegramWarn = logger.warn;
export const telegramError = logger.error;
