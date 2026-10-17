import type { BotConfig } from "grammy";
import { createChannelBot } from "../bot";
import { TELEGRAM_CHANNEL } from "../channel";
import type { Ctx } from "../context";

/**
 * Builds the Telegram bot. All of the behaviour lives in the shared
 * `createChannelBot`; this only pins the channel, keeping the original
 * `createBot(token, config)` signature (and the offline test's stub transport
 * injection) intact.
 */
export function createBot(token: string, config?: BotConfig<Ctx>) {
  return createChannelBot(TELEGRAM_CHANNEL, config, token);
}
