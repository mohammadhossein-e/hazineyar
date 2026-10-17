import { TELEGRAM_CHANNEL } from "../channel";
import {
  createChannelChatNotifier,
  createChannelNotifier,
} from "../notifier";

/**
 * Telegram notifiers. The transport lives in the shared channel factory; these
 * wrappers keep the original import paths (and default-token behaviour) intact.
 */
export function createTelegramNotifier(token?: string) {
  return createChannelNotifier(TELEGRAM_CHANNEL, token);
}

export function createTelegramChatNotifier(token?: string) {
  return createChannelChatNotifier(TELEGRAM_CHANNEL, token);
}
