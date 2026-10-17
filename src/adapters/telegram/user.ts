import { createUserFinder } from "../user";

/**
 * Telegram user lookup. The (channel, externalId) matching lives in the shared
 * `createUserFinder`; this keeps the original `findTelegramUser` name.
 */
export const findTelegramUser = createUserFinder("telegram");
