import { config } from "@/lib/config";
import { CHANNEL_LABELS, channelLabel, type ChannelId } from "@/core/channels";

export type { ChannelId };
export { channelLabel };

/**
 * Everything the shared bot machinery needs to know about a network, gathered
 * in one place so no handler has to branch on "which channel am I".
 *
 * The differences that actually matter between Telegram and Bale are all here:
 * the API host, whether groups are workable at all, and where a file download
 * endpoint lives. Behaviour that is identical on both networks is written once
 * against this shape.
 */
export interface ChannelConfig {
  readonly id: ChannelId;
  /** Persian label shown on the dashboard. */
  readonly label: string;
  /** Bot token; empty when the bot is not configured. */
  readonly token: string;
  /**
   * grammy's API root override. `undefined` keeps grammy's built-in Telegram
   * default; Bale needs its own host. Must not end in a slash.
   */
  readonly apiRoot?: string;
  /** Public handle without the leading `@`; empty when unset. */
  readonly botUsername: string;
  /**
   * Whether group linking/announcements are offered. Bale hides bots with fewer
   * than 20 users from groups, so that whole surface is Telegram-only for now.
   */
  readonly supportsGroups: boolean;
  /**
   * Whether every callback query must be answered the instant it arrives, before
   * any handler runs. Bale expires callback queries quickly and a late answer is
   * rejected, so it needs a global early-ack middleware; Telegram does not.
   */
  readonly ackCallbacksGlobally: boolean;
  /** Prefix for the file endpoint: `<fileBaseUrl>/bot<token>/<file_path>`. */
  readonly fileBaseUrl: string;
  /** Deep link that opens the bot's private chat with an optional payload. */
  chatLink(username: string, payload?: string): string;
}

export const TELEGRAM_CHANNEL: ChannelConfig = {
  id: "telegram",
  label: CHANNEL_LABELS.telegram,
  token: config.telegramBotToken,
  botUsername: config.telegramBotUsername,
  supportsGroups: true,
  ackCallbacksGlobally: false,
  fileBaseUrl: "https://api.telegram.org/file",
  chatLink: (username, payload) =>
    `https://t.me/${username}${payload ? `?start=${payload}` : ""}`,
};

export const BALE_CHANNEL: ChannelConfig = {
  id: "bale",
  label: CHANNEL_LABELS.bale,
  token: config.baleBotToken,
  apiRoot: config.baleApiBase,
  botUsername: config.baleBotUsername,
  // Group support is disabled: the Bale bot cannot be added to a group yet.
  supportsGroups: false,
  // Bale rejects a late answerCallbackQuery, so callbacks are acked up front.
  ackCallbacksGlobally: true,
  fileBaseUrl: `${config.baleApiBase}/file`,
  chatLink: (username, payload) =>
    `https://ble.ir/${username}${payload ? `?start=${payload}` : ""}`,
};

/** The configured channels, in dashboard order. */
export const CHANNELS: readonly ChannelConfig[] = [TELEGRAM_CHANNEL, BALE_CHANNEL];

const BY_ID: Record<ChannelId, ChannelConfig> = {
  telegram: TELEGRAM_CHANNEL,
  bale: BALE_CHANNEL,
};

/** Resolves a persisted channel id; unknown ids fall back to Telegram. */
export function channelById(id: string): ChannelConfig {
  return BY_ID[id as ChannelId] ?? TELEGRAM_CHANNEL;
}
