/**
 * The messaging networks the app knows about, kept in the core so services and
 * presenters can name them without reaching into an adapter. The transport
 * details (API host, tokens) live in `src/adapters/channel.ts`.
 */
export type ChannelId = "telegram" | "bale";

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  telegram: "تلگرام",
  bale: "بله",
};

export const DEFAULT_CHANNEL: ChannelId = "telegram";

/**
 * Narrows a persisted channel id to a known one. Legacy rows (and any value the
 * database hands back) default to Telegram, matching the bot's own fallback.
 */
export function toChannelId(id: string | null | undefined): ChannelId {
  return id === "bale" ? "bale" : DEFAULT_CHANNEL;
}

/** Persian label for a persisted channel id, tolerant of legacy/unknown values. */
export function channelLabel(id: string): string {
  return CHANNEL_LABELS[id as ChannelId] ?? id;
}
