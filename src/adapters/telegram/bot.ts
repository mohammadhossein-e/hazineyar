import { Bot, type BotConfig, type MiddlewareFn } from "grammy";
import type { Ctx } from "./context";
import { conversationsPlugin, expenseConversation } from "./conversation";
import { CALLBACK, CONVERSATION_ID } from "./keys";
import { telegramError, telegramWarn } from "./logger";
import { MESSAGES } from "./messages";
import { findTelegramUser } from "./user";

/**
 * Cancelling is registered *before* the conversation middleware on purpose: an
 * active conversation swallows updates that do not match its current step, so
 * a `/cancel` (or the inline cancel button) handled afterwards would never be
 * seen. `exitAll` tears the flow down and the update is finished here.
 */
const cancelMiddleware: MiddlewareFn<Ctx> = async (ctx, next) => {
  const isCommand = ctx.hasCommand("cancel");
  const isButton = ctx.hasCallbackQuery?.(CALLBACK.cancel) === true;
  if (!isCommand && !isButton) return next();

  if (isButton) await ctx.answerCallbackQuery();
  await ctx.conversation.exitAll();
  await ctx.reply(MESSAGES.cancelled);
};

async function startExpense(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    await ctx.reply(MESSAGES.notRegistered);
    return;
  }
  await ctx.conversation.enter(CONVERSATION_ID);
}

/**
 * Builds a ready-to-run bot. The token is never logged, so a bad token shows up
 * as a BotInfoUnavailable error from Telegram rather than a leaked secret.
 *
 * `config` is passed straight to grammy. The conversations plugin rebuilds an
 * `Api` per replayed context from these same client options, which is how
 * `scripts/test-bot.ts` swaps in a stub transport.
 */
export function createBot(token: string, config?: BotConfig<Ctx>): Bot<Ctx> {
  const bot = new Bot<Ctx>(token, config);

  bot.use(conversationsPlugin);
  bot.use(cancelMiddleware);
  bot.use(expenseConversation);

  bot.command("start", (ctx) => ctx.reply(MESSAGES.start));
  bot.command("help", (ctx) => ctx.reply(MESSAGES.help));
  bot.command(["expense", "هزینه"], startExpense);

  bot.callbackQuery(CALLBACK.retry, (ctx) =>
    ctx.conversation.enter(CONVERSATION_ID),
  );

  bot.on("message:text", async (ctx) => {
    if (!ctx.from) return;
    const user = await findTelegramUser(ctx.from.id);
    await ctx.reply(user ? MESSAGES.unexpected : MESSAGES.notRegistered);
  });

  // The fallback for any middleware that throws (a dead database, a Telegram
  // transport hiccup...). A reply is attempted so the user always hears a
  // Persian explanation instead of a silent drop; the attempt itself must
  // never throw, since this is the last line of defense.
  bot.catch(async (error) => {
    telegramError("update failed", error);
    if (error.ctx) {
      try {
        await error.ctx.reply(MESSAGES.genericError);
      } catch {
        telegramWarn("could not report the error to the user");
      }
    }
  });

  return bot;
}
