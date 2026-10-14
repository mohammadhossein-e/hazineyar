/**
 * A channel-agnostic way to send a one-off message to a user.
 *
 * Core code (the approval service) depends only on this shape, never on a
 * concrete transport, so `src/core` stays free of Telegram and Next.js. The
 * Telegram implementation lives in `src/adapters/telegram/notifier.ts` and
 * talks to the Bot API over plain HTTPS, because the web process cannot reach
 * the separately-running bot instance.
 *
 * A notification is best-effort: callers must treat a thrown error as "could
 * not tell the user" and never let it roll back the work that preceded it.
 */
export type Notifier = {
  notifyUser(externalId: string, text: string): Promise<void>;
};

/**
 * A channel-agnostic way to post a one-off message to a linked chat, used to
 * announce a correction to the group an expense was announced in. Like
 * `Notifier`, it is best-effort: a thrown error means "the group was not told",
 * and must never roll back the correction that already happened.
 */
export type ChatNotifier = {
  notifyChat(externalChatId: string, text: string): Promise<void>;
};
