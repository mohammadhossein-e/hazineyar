import type { ChatNotifier, Notifier } from "@/core/notify";
import { channelById, type ChannelConfig } from "./channel";

/**
 * Bot API calls are synchronous within a request; a hung socket must not hold
 * the admin's approval open, so every call is bounded.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Sends a plain message through a Bot API over HTTPS.
 *
 * This deliberately does not go through a running bot's grammy instance: the
 * web server and the bot are separate processes, so the only shared thing is
 * the token. It is used to tell an approved user their access was granted.
 */
export function createChannelNotifier(
  channel: ChannelConfig,
  token: string = channel.token,
): Notifier {
  return {
    async notifyUser(externalId: string, text: string): Promise<void> {
      await sendMessage(channel, token, externalId, text);
    },
  };
}

/**
 * Posts a message to a linked chat. The dashboard's correction flows need this
 * because the web process has no bot instance; it shares the same HTTPS call as
 * `createChannelNotifier`.
 */
export function createChannelChatNotifier(
  channel: ChannelConfig,
  token: string = channel.token,
): ChatNotifier {
  return {
    async notifyChat(externalChatId: string, text: string): Promise<void> {
      await sendMessage(channel, token, externalChatId, text);
    },
  };
}

/**
 * The channel-routed entry point: the approval route persists the channel on
 * every access request, so it can notify the user over the network they
 * actually came from instead of assuming Telegram.
 */
export function notifierForChannel(channelId: string): Notifier {
  return createChannelNotifier(channelById(channelId));
}

export function chatNotifierForChannel(channelId: string): ChatNotifier {
  return createChannelChatNotifier(channelById(channelId));
}

async function sendMessage(
  channel: ChannelConfig,
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  if (!token) {
    throw new Error(`${channel.id} bot token is not configured`);
  }

  const base = channel.apiRoot ?? "https://api.telegram.org";
  const response = await fetch(`${base}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;

  if (!response.ok || !body?.ok) {
    throw new Error(
      `${channel.id} sendMessage failed (${response.status}): ${
        body?.description ?? "unknown error"
      }`,
    );
  }
}
