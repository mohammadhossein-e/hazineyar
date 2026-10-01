import { conversations, createConversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import type { ExpenseCategory } from "@prisma/client";
import { DomainError } from "@/core/errors";
import { categoryLabel, parseCategory } from "@/core/expenses/categories";
import { attachInvoiceFile, createExpense } from "@/core/expenses/service";
import { listProjectsForUser } from "@/core/users/service";
import { config } from "@/lib/config";
import { saveInvoiceFile } from "@/lib/uploads";
import type { Ctx } from "./context";
import { formatAmount, parseAmount, parseDescription } from "./format";
import { CALLBACK, CONVERSATION_ID } from "./keys";
import {
  cancelKeyboard,
  categoryKeyboard,
  projectKeyboard,
  retryKeyboard,
  skipDescriptionKeyboard,
  skipInvoiceKeyboard,
} from "./keyboards";
import { telegramLog, telegramWarn } from "./logger";
import { downloadInvoiceMedia, hasInvoiceMedia } from "./media";
import { failedWithRetry, MESSAGES, savedConfirmation } from "./messages";
import { findTelegramUser } from "./user";

const PROJECT_PATTERN = new RegExp(`^${CALLBACK.project}(.+)$`);
const CATEGORY_PATTERN = new RegExp(`^${CALLBACK.category}(.+)$`);

type Invoice = { buffer: Buffer; mimeType: string };

/** Idle flows are dropped after the configured TTL so state cannot leak. */
const waitOptions = () => ({
  maxMilliseconds: config.telegramConversationTtlMs,
});

function reasonOf(error: unknown): string {
  return error instanceof DomainError ? error.message : MESSAGES.genericError;
}

/**
 * The plugin that installs `ctx.conversation` controls. It must be registered
 * before any `createConversation` middleware, which looks the plugin state up
 * on the context.
 */
export const conversationsPlugin = conversations<Ctx, Context>();

/**
 * The guided entry flow. The plugin rebuilds a context for every update it
 * replays, so the user and their projects are re-resolved from `ctx.from.id`
 * here rather than carried in from the outside middleware.
 *
 * Every step gets an explicit `collationKey` and validates inside the wait
 * predicate. Both matter: waits are keyed by type by default, so two
 * `waitForCallbackQuery` calls in one flow would share a key and corrupt the
 * replay state, and a `while` loop re-registers the same key on every turn.
 * Invalid input is handled by `otherwise`, which re-prompts without consuming
 * a turn of the conversation.
 *
 * The entry snapshot (user + project list) is resolved once via
 * `conv.external` and reused on replays. Without this, re-resolving the
 * project list on every replay would re-authorize the earlier pick: if access
 * is revoked mid-flow, the replay would abort with "pick again" instead of
 * reaching the write-time check in `createExpense`, which is what must refuse
 * the write and explain why.
 */
export const expenseConversation = createConversation<Ctx, Context>(
  async (conv, ctx) => {
    if (!ctx.from) return;

    const entry = await conv.external(async () => {
      try {
        const user = await findTelegramUser(ctx.from!.id);
        if (!user) return { error: "unknown-user" } as const;
        // A deactivated account keeps its history but may not record anything
        // more, so it is refused here rather than shown an empty project list.
        if (!user.isActive) return { error: "inactive" } as const;
        const projects = await listProjectsForUser(user.id);
        return {
          userId: user.id,
          projects: projects.map((p) => ({ id: p.id, name: p.name })),
        };
      } catch (error) {
        // A dying database mid-conversation must surface as a message, not as
        // a silent drop. The global error handler would only log it.
        telegramWarn("conversation entry could not be resolved", error);
        return { error: "unavailable" } as const;
      }
    });
    if ("error" in entry) {
      const reply =
        entry.error === "unavailable"
          ? MESSAGES.genericError
          : entry.error === "inactive"
            ? MESSAGES.noAccess
            : MESSAGES.notRegistered;
      await ctx.reply(reply);
      return;
    }
    if (entry.projects.length === 0) {
      await ctx.reply(MESSAGES.noProjects);
      return;
    }

    await ctx.reply(MESSAGES.pickProject, {
      reply_markup: projectKeyboard(entry.projects),
    });
    const projectStep = await conv.waitForCallbackQuery(PROJECT_PATTERN, {
      ...waitOptions(),
      collationKey: "project",
      otherwise: (c) => c.reply(MESSAGES.pickProjectAgain),
    });
    await projectStep.answerCallbackQuery();
    // The picked id is taken as-is: authorization is enforced at write time
    // by `createExpense`, not by re-checking the current project list here.
    const projectId = projectStep.match[1];

    await ctx.reply(MESSAGES.pickCategory, {
      reply_markup: categoryKeyboard(),
    });
    const categoryStep = await conv.waitForCallbackQuery(CATEGORY_PATTERN, {
      ...waitOptions(),
      collationKey: "category",
      otherwise: (c) => c.reply(MESSAGES.pickCategoryAgain),
    });
    await categoryStep.answerCallbackQuery();
    const category = parseCategory(categoryStep.match[1]) as
      | ExpenseCategory
      | null;
    if (!category) {
      await ctx.reply(MESSAGES.pickCategoryAgain);
      return;
    }

    await ctx.reply(MESSAGES.enterAmount, { reply_markup: cancelKeyboard() });
    const amountStep = await conv.waitUntil(
      (c) => !!c.msg?.text && parseAmount(c.msg.text) !== null,
      {
        ...waitOptions(),
        collationKey: "amount",
        otherwise: (c) => c.reply(MESSAGES.invalidAmount),
      },
    );
    const amount = parseAmount(amountStep.msg?.text ?? "");
    if (amount === null) {
      await ctx.reply(MESSAGES.invalidAmount);
      return;
    }

    await ctx.reply(MESSAGES.askDescription, {
      reply_markup: skipDescriptionKeyboard(),
    });
    // A note is optional, so the step is satisfied either by the skip button or
    // by any text the core schema would accept. The button arrives as a
    // callback query, never as a message, so it cannot be mistaken for a note.
    const descriptionStep = await conv.waitUntil(
      (c) =>
        c.callbackQuery?.data === CALLBACK.skipDescription ||
        (!!c.msg?.text && parseDescription(c.msg.text) !== null),
      {
        ...waitOptions(),
        collationKey: "description",
        otherwise: (c) =>
          c.reply(
            c.msg?.text
              ? MESSAGES.descriptionTooLong
              : MESSAGES.descriptionAgain,
          ),
      },
    );

    let description: string | undefined;
    if (descriptionStep.callbackQuery?.data === CALLBACK.skipDescription) {
      await descriptionStep.answerCallbackQuery();
    } else {
      const text = parseDescription(descriptionStep.msg?.text ?? "");
      if (text === null) {
        // Unreachable while the predicate holds, so the user is re-prompted
        // rather than silently truncated.
        await descriptionStep.reply(MESSAGES.descriptionTooLong);
        return;
      }
      // Whitespace-only input trims to "", which means "no note".
      description = text || undefined;
    }

    await ctx.reply(MESSAGES.askInvoice, {
      reply_markup: skipInvoiceKeyboard(),
    });
    const invoiceStep = await conv.waitUntil(
      (c) =>
        c.callbackQuery?.data === CALLBACK.skipInvoice ||
        hasInvoiceMedia(c.msg),
      {
        ...waitOptions(),
        collationKey: "invoice",
        otherwise: (c) => c.reply(MESSAGES.askInvoiceAgain),
      },
    );

    let invoice: Invoice | null = null;
    if (invoiceStep.callbackQuery?.data === CALLBACK.skipInvoice) {
      telegramLog("invoice skipped by the user");
      await invoiceStep.answerCallbackQuery();
    } else {
      try {
        // Both a plain photo and a document are accepted: Telegram delivers the
        // first as `photo` and the second as `document`, and only the message
        // itself knows which one it is.
        invoice = await downloadInvoiceMedia(invoiceStep.api, invoiceStep.msg!);
        telegramLog("invoice accepted");
        await invoiceStep.reply("✅ فاکتور دریافت شد.");
      } catch (error) {
        telegramWarn("invoice rejected", error);
        await invoiceStep.reply(failedWithRetry(reasonOf(error)));
      }
    }

    let expense;
    try {
      expense = await createExpense({
        projectId,
        userId: entry.userId,
        category,
        amount,
        description,
        expenseDate: new Date(),
      });
    } catch (error) {
      telegramWarn("expense could not be created", error);
      await ctx.reply(failedWithRetry(reasonOf(error)), {
        reply_markup: retryKeyboard(),
      });
      return;
    }

    let hasInvoice = false;
    if (invoice) {
      let stored: string | null = null;
      try {
        stored = await saveInvoiceFile({
          buffer: invoice.buffer,
          mimeType: invoice.mimeType,
          invoiceNumber: expense.invoiceNumber,
        });
        telegramLog(`invoice stored as ${stored}`);
      } catch (error) {
        telegramWarn(`invoice not stored on ${expense.invoiceNumber}`, error);
        await ctx.reply(MESSAGES.saveFailed);
      }

      if (stored) {
        try {
          await attachInvoiceFile(expense.id, stored);
          hasInvoice = true;
          telegramLog(`invoice attached to ${expense.invoiceNumber}`);
        } catch (error) {
          telegramWarn(`invoice not attached on ${expense.invoiceNumber}`, error);
          await ctx.reply(MESSAGES.attachFailed);
        }
      }
    }

    await ctx.reply(
      savedConfirmation({
        projectName: expense.project.name,
        category: categoryLabel(category),
        amount: formatAmount(expense.amount),
        invoiceNumber: expense.invoiceNumber,
        hasInvoice,
        description: expense.description,
      }),
    );
  },
  { id: CONVERSATION_ID },
);
