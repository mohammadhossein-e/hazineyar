import type { BotConfig } from "grammy";
import { config } from "@/lib/config";
import { createChannelBot } from "../bot";
import { BALE_CHANNEL } from "../channel";
import type { Ctx } from "../context";

/**
 * Builds the Bale bot. Bale speaks the Telegram Bot API, so the shared
 * `createChannelBot` drives it unchanged; the channel config supplies Bale's API
 * host, turns group features off, and enables the early callback acknowledgement
 * Bale needs.
 */
export function createBaleBot(
  token: string = config.baleBotToken,
  botConfig?: BotConfig<Ctx>,
) {
  return createChannelBot(BALE_CHANNEL, botConfig, token);
}
