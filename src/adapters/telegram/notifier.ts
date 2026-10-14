import type { Notifier, ChatNotifier } from "@/core/notify";
import { config } from "@/lib/config";

/**
 * Telegram calls to api.telegram.org are synchronous within a request; a
 * hung socket must not hold the admin's approval open, so every call is
 * bounded.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Sends a plain message through the Telegram Bot API over HTTPS.
 *
 * This deliberately does not go through the running bot's grammy instance:
 * the web server and the bot are separate processes, so the only shared thing
 * is the token. It is used to tell an approved user their access was granted.
 */
export function createTelegramNotifier(
  token: string = config.telegramBotToken,
): Notifier {
  return {
    async notifyUser(externalId: string, text: string): Promise<void> {
      await sendMessage(token, externalId, text);
    },
  };
}

/**
 * Posts a message to a linked group chat. The dashboard's correction flows need
 * this because the web process has no bot instance; it shares the same HTTPS
 * call as `createTelegramNotifier`.
 */
export function createTelegramChatNotifier(
  token: string = config.telegramBotToken,
): ChatNotifier {
  return {
    async notifyChat(externalChatId: string, text: string): Promise<void> {
      await sendMessage(token, externalChatId, text);
    },
  };
}

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
      `Telegram sendMessage failed (${response.status}): ${
        body?.description ?? "unknown error"
      }`,
    );
  }
}
