import { Bot, type BotConfig, type MiddlewareFn } from "grammy";
import { recordAccessRequest } from "@/core/access/service";
import type { AccessRequestOutcome } from "@/core/access/service";
import { getLinkedChat, linkChat, unlinkChat } from "@/core/chats/service";
import { DomainError } from "@/core/errors";
import { cancelExpense } from "@/core/expenses/service";
import { parseQuickEntry } from "@/core/expenses/quick-entry";
import { parseAnnouncedChats } from "@/core/expenses/announcement";
import { listProjectsForUser } from "@/core/users/service";
import type { Ctx } from "./context";
import {
  conversationsPlugin,
  expenseConversation,
  type GroupOrigin,
} from "./conversation";
import { announceExpenseCorrection } from "./announce";
import { CALLBACK, CONVERSATION_ID, GROUP_PAYLOAD_PREFIX } from "./keys";
import { startPrivateKeyboard } from "./keyboards";
import { telegramError, telegramWarn } from "./logger";
import { resolveInvoiceMedia } from "./media";
import { MESSAGES, selfCancelSuccess } from "./messages";
import { findTelegramUser } from "./user";

/** Only `g<absolute group id>` payloads are ours; anything else is ignored. */
const GROUP_PAYLOAD_PATTERN = new RegExp(
  `^${GROUP_PAYLOAD_PREFIX}(\\d{3,20})$`,
);

function isPrivate(ctx: Ctx): boolean {
  return ctx.chat?.type === "private";
}

function isGroup(ctx: Ctx): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function displayNameOf(from: {
  first_name: string;
  last_name?: string;
  username?: string;
}): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || from.username || "";
}

function isAdmin(user: Awaited<ReturnType<typeof findTelegramUser>>): boolean {
  return !!user && user.isActive && user.role === "ADMIN";
}

async function replyAccessOutcome(
  ctx: Ctx,
  outcome: AccessRequestOutcome,
): Promise<void> {
  const text =
    outcome === "rejected"
      ? MESSAGES.accessRejected
      : outcome === "busy"
        ? MESSAGES.accessBusy
        : MESSAGES.accessRequested;
  await ctx.reply(text);
}

async function recordRequest(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;
  await replyAccessOutcome(
    ctx,
    await recordAccessRequest({
      channel: "telegram",
      externalId: String(ctx.from.id),
      displayName: displayNameOf(ctx.from),
      username: ctx.from.username,
    }),
  );
}

/**
 * A `/start` payload only becomes an origin if it parses *and* names a chat
 * that is currently linked. A forged id for a group the admin never linked is
 * indistinguishable from no payload, so it can never route an announcement.
 */
async function resolveGroupOrigin(ctx: Ctx): Promise<GroupOrigin | null> {
  const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (!payload) return null;

  const match = GROUP_PAYLOAD_PATTERN.exec(payload);
  if (!match) return null;

  const groupChatId = `-${match[1]}`;
  const linked = await getLinkedChat("telegram", groupChatId);
  if (!linked) {
    telegramWarn(`ignored a start payload for unlinked chat ${groupChatId}`);
    return null;
  }
  return { groupChatId };
}

/**
 * Cancelling is registered *before* the conversation middleware on purpose: an
 * active conversation swallows updates that do not match its current step, so
 * a `/cancel` (or the inline cancel button) handled afterwards would never be
 * seen. `exitAll` tears the flow down and the update is finished here. It only
 * applies to private chats; a group has no flow to cancel.
 */
const cancelMiddleware: MiddlewareFn<Ctx> = async (ctx, next) => {
  if (!isPrivate(ctx)) return next();

  const isCommand = ctx.hasCommand("cancel");
  const isButton = ctx.hasCallbackQuery?.(CALLBACK.cancel) === true;
  if (!isCommand && !isButton) return next();

  if (isButton) await ctx.answerCallbackQuery();
  await ctx.conversation.exitAll();
  await ctx.reply(MESSAGES.cancelled);
};

async function handleStart(ctx: Ctx): Promise<void> {
  if (!isPrivate(ctx) || !ctx.from) return;

  const origin = await resolveGroupOrigin(ctx);
  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    // The private chat is the only place an access request is born; the
    // group's /expense just points people here.
    await recordRequest(ctx);
    return;
  }

  // A valid group deep link from a registered user drops straight into the
  // guided flow, which announces back to the group when it finishes.
  if (origin) {
    await ctx.conversation.enter(CONVERSATION_ID, { origin });
    return;
  }

  await ctx.reply(MESSAGES.start);
}

async function startExpense(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;

  if (isGroup(ctx)) {
    await handleGroupExpense(ctx);
    return;
  }
  if (!isPrivate(ctx)) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    await recordRequest(ctx);
    return;
  }
  await ctx.conversation.enter(CONVERSATION_ID);
}

/**
 * Group `/expense` never runs the multi-step flow in the group. In a linked
 * group it answers with a deep link into the private chat; in an unlinked one
 * it says, once, how to link the group.
 */
async function handleGroupExpense(ctx: Ctx): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const chatId = String(ctx.chat.id);

  const linked = await getLinkedChat("telegram", chatId);
  if (!linked) {
    await ctx.reply(MESSAGES.groupNotLinked);
    return;
  }

  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    await ctx.reply(MESSAGES.groupRegisterFirst, {
      reply_markup: startPrivateKeyboard(
        ctx.me.username,
        `${GROUP_PAYLOAD_PREFIX}${Math.abs(ctx.chat.id)}`,
        MESSAGES.privateStartButton,
      ),
    });
    return;
  }
  if (!user.isActive) {
    await ctx.reply(MESSAGES.noAccess);
    return;
  }

  await ctx.reply(MESSAGES.groupAskPrivate, {
    reply_markup: startPrivateKeyboard(
      ctx.me.username,
      `${GROUP_PAYLOAD_PREFIX}${Math.abs(ctx.chat.id)}`,
      MESSAGES.privateButton,
    ),
  });
}

async function handleLinkGroup(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;
  if (isPrivate(ctx)) {
    await ctx.reply(MESSAGES.linkGroupOnlyInGroup);
    return;
  }
  if (!isGroup(ctx) || !ctx.chat) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!isAdmin(user)) {
    await ctx.reply(MESSAGES.linkGroupNotAllowed);
    return;
  }

  const title =
    "title" in ctx.chat && ctx.chat.title ? ctx.chat.title : String(ctx.chat.id);
  await linkChat({
    channel: "telegram",
    externalChatId: String(ctx.chat.id),
    title,
  });
  await ctx.reply(MESSAGES.linkGroupDone);
}

async function handleUnlinkGroup(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;
  if (isPrivate(ctx)) {
    await ctx.reply(MESSAGES.linkGroupOnlyInGroup);
    return;
  }
  if (!isGroup(ctx) || !ctx.chat) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!isAdmin(user)) {
    await ctx.reply(MESSAGES.linkGroupNotAllowed);
    return;
  }

  const removed = await unlinkChat("telegram", String(ctx.chat.id));
  await ctx.reply(removed ? MESSAGES.unlinkGroupDone : MESSAGES.linkGroupNotLinked);
}

/**
 * The employee's self-cancel button, shown on the saved confirmation. It lives
 * outside the conversation (the flow has already ended) and validates
 * ownership and the time window in the core, so a forwarded or stale button can
 * never cancel someone else's expense or a closed one.
 */
async function handleSelfCancel(ctx: Ctx): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  if (!ctx.from) return;

  const data = ctx.callbackQuery?.data ?? "";
  const expenseId = data.slice(CALLBACK.selfCancel.length);
  if (!expenseId) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    await ctx.reply(MESSAGES.notRegistered);
    return;
  }

  let expense;
  try {
    expense = await cancelExpense(expenseId, user.id, {
      reason: "لغو توسط ثبت‌کننده از ربات",
    });
  } catch (error) {
    const text =
      error instanceof DomainError ? error.message : MESSAGES.genericError;
    await ctx.reply(text);
    return;
  }

  await ctx.reply(selfCancelSuccess(expense.invoiceNumber));

  // Announce the cancellation to the group that saw the original, best-effort:
  // the cancellation already stands, so a failed notice never changes it.
  try {
    await announceExpenseCorrection(
      {
        notifyChat: async (chatId, text) => {
          await ctx.api.sendMessage(chatId, text);
        },
      },
      {
        announcedChats: parseAnnouncedChats(expense.announcedChats),
        userName: expense.user.name,
        projectName: expense.project.name,
        category: expense.category,
        amount: expense.amount,
      },
      "cancel",
      { reason: expense.deletedReason },
    );
  } catch (error) {
    telegramWarn("group correction notice failed for a self-cancel", error);
  }
}

/**
 * Free text in the private chat is an attempt at a one-line expense entry
 * ("سعادت‌آباد مصالح ۱٬۲۵۰٬۰۰۰ خرید سیمان"). The parsing lives in the core; this
 * handler only decides what the parse means and hands the flow the fields it
 * understood.
 *
 * The type of the entry is never guessed: a project is taken only when its name
 * matched a user's project exactly. When a project/category was recognised but
 * no amount was, the flow first restates what it understood and waits for a tap.
 */
async function handleQuickEntry(ctx: Ctx): Promise<void> {
  if (!isPrivate(ctx) || !ctx.from) return;
  const text = ctx.msg?.text;
  if (!text) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!user) {
    await ctx.reply(MESSAGES.notRegistered);
    return;
  }
  if (!user.isActive) {
    await ctx.reply(MESSAGES.noAccess);
    return;
  }

  const projects = (await listProjectsForUser(user.id)).map((p) => ({
    id: p.id,
    name: p.name,
  }));
  if (projects.length === 0) {
    await ctx.reply(MESSAGES.noProjects);
    return;
  }

  const parsed = parseQuickEntry(text, projects);
  if (parsed.kind === "invalid-amount") {
    await ctx.reply(MESSAGES.quickAmountInvalid);
    return;
  }
  if (parsed.kind === "empty") {
    await ctx.reply(MESSAGES.unexpected);
    return;
  }

  // A line with none of amount/project/category is ordinary chatter; answering
  // it with a flow would be a surprise.
  if (parsed.amount === null && !parsed.project && !parsed.category) {
    await ctx.reply(MESSAGES.unexpected);
    return;
  }

  await ctx.conversation.enter(CONVERSATION_ID, {
    prefill: {
      amount: parsed.amount ?? undefined,
      projectId: parsed.project?.id,
      category: parsed.category ?? undefined,
      // With an amount the entry is settled (leftover or none); without one the
      // missing amount is asked first and the note later, so leave it undecided.
      description:
        parsed.amount !== null ? (parsed.description ?? null) : undefined,
    },
    awaitContinue: parsed.amount === null,
    skipInvoice: true,
  });
}

/**
 * A photo or document in the private chat, outside any flow, is taken as the
 * invoice for an expense. The caption is parsed exactly like a text entry; an
 * absent or unusable caption still starts the guided flow, with the file
 * already attached, so the user is not asked for it again.
 *
 * Unregistered and inactive senders are ignored on purpose: unlike a command,
 * a stray photo must not trigger an access request or a "no access" reply.
 */
async function handlePhotoEntry(ctx: Ctx): Promise<void> {
  if (!isPrivate(ctx) || !ctx.from || !ctx.msg) return;

  const media = resolveInvoiceMedia(ctx.msg);
  if (!media) return;

  const user = await findTelegramUser(ctx.from.id);
  if (!user || !user.isActive) return;

  const projects = (await listProjectsForUser(user.id)).map((p) => ({
    id: p.id,
    name: p.name,
  }));
  if (projects.length === 0) {
    await ctx.reply(MESSAGES.noProjects);
    return;
  }

  const caption = ctx.msg.caption?.trim() ?? "";
  const parsed = caption
    ? parseQuickEntry(caption, projects)
    : ({ kind: "parsed", amount: null, project: null, category: null, description: null } as const);

  if (parsed.kind === "invalid-amount") {
    // The amount was the only thing wrong; say so, then let the flow ask it
    // with the invoice already attached.
    await ctx.reply(MESSAGES.quickAmountInvalid);
  }

  const usable = parsed.kind === "parsed" ? parsed : null;
  const recognised =
    !!usable && (usable.amount !== null || usable.project || usable.category);

  await ctx.conversation.enter(CONVERSATION_ID, {
    prefill: usable
      ? {
          amount: usable.amount ?? undefined,
          projectId: usable.project?.id,
          category: usable.category ?? undefined,
          description:
            usable.amount !== null ? (usable.description ?? null) : undefined,
        }
      : undefined,
    invoice: media,
    awaitContinue: !!usable && usable.amount === null && recognised,
  });
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

  bot.command("start", handleStart);
  bot.command("help", (ctx) =>
    isPrivate(ctx) ? ctx.reply(MESSAGES.help) : Promise.resolve(),
  );
  bot.command(["expense", "هزینه"], startExpense);
  bot.command("linkgroup", handleLinkGroup);
  bot.command("unlinkgroup", handleUnlinkGroup);

  bot.callbackQuery(CALLBACK.retry, (ctx) =>
    ctx.conversation.enter(CONVERSATION_ID),
  );

  // The «ادامه با دکمهها» button is normally consumed by the active flow. This
  // is only reached when no flow is running (it expired), so the user still gets
  // a working flow rather than a dead button.
  bot.callbackQuery(CALLBACK.quickContinue, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(CONVERSATION_ID);
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK.selfCancel}`), handleSelfCancel);

  // A one-line entry ("سعادت‌آباد مصالح ۱٬۲۵۰٬۰۰۰") or plain chatter. Group
  // chatter is left alone: with privacy mode on Telegram rarely delivers it
  // anyway, and answering would only be noise.
  bot.on("message:text", handleQuickEntry);

  // A photo or document in the private chat is an invoice for a new expense.
  bot.on(["message:photo", "message:document"], handlePhotoEntry);

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
