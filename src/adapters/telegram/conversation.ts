import { conversations, createConversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import type { ExpenseCategory } from "@prisma/client";
import { DomainError } from "@/core/errors";
import { categoryLabel, parseCategory } from "@/core/expenses/categories";
import {
  attachInvoiceFile,
  createExpense,
  recordExpenseAnnouncement,
} from "@/core/expenses/service";
import { getCancellationSettings } from "@/core/settings/service";
import { listProjectsForUser } from "@/core/users/service";
import { config } from "@/lib/config";
import { saveInvoiceFile } from "@/lib/uploads";
import { announceExpense } from "./announce";
import type { Ctx } from "./context";
import { formatAmount, parseAmount, parseDescription } from "./format";
import { CALLBACK, CONVERSATION_ID } from "./keys";
import {
  cancelKeyboard,
  categoryKeyboard,
  confirmKeyboard,
  editFieldsKeyboard,
  projectKeyboard,
  quickContinueKeyboard,
  retryKeyboard,
  selfCancelKeyboard,
  skipDescriptionKeyboard,
  skipInvoiceKeyboard,
} from "./keyboards";
import { telegramLog, telegramWarn } from "./logger";
import {
  downloadInvoice,
  downloadInvoiceMedia,
  hasInvoiceMedia,
  type InvoiceMedia,
} from "./media";
import {
  expenseSummaryForConfirm,
  failedWithRetry,
  lastChoiceHint,
  lastChoiceShortcut,
  MESSAGES,
  quickUnderstoodLines,
  savedConfirmation,
} from "./messages";
import { findTelegramUser } from "./user";

/**
 * The project step also accepts the one-tap "same as last time" shortcut. The
 * alternation keeps a single `waitForCallbackQuery` (and therefore a single
 * collation key) for both choices; group 1 is the project id, or undefined when
 * the shortcut was pressed.
 */
const PROJECT_OR_LAST_PATTERN = new RegExp(
  `^(?:${CALLBACK.project}(.+)|${CALLBACK.lastChoice})$`,
);
const CATEGORY_PATTERN = new RegExp(`^${CALLBACK.category}(.+)$`);
const CONFIRM_PATTERN = new RegExp(`^${CALLBACK.confirm}(approve|edit|cancel)$`);
const EDIT_FIELD_PATTERN = new RegExp(
  `^${CALLBACK.editField}(project|category|amount|description)$`,
);

/**
 * The summary step lets the user redo a single field and come back. The loop is
 * bounded so a user cannot grow the replay state without limit; after the cap
 * the expense is saved as it stands.
 */
const MAX_CONFIRM_ROUNDS = 5;

type Invoice = { buffer: Buffer; mimeType: string };

/**
 * Where the flow came from. It is passed into the conversation through
 * `ctx.conversation.enter` when the user arrives from a group's deep link, so
 * it survives every replay with the conversation and disappears when the flow
 * is cancelled or times out. A plain private `/expense` carries no origin and
 * therefore announces nothing.
 */
export type GroupOrigin = { groupChatId: string };

/**
 * Values a one-line entry (or a photo caption) resolved before the flow starts.
 * A prefilled field is skipped rather than asked again, so a complete line goes
 * straight to the summary.
 */
export type ExpensePrefill = {
  amount?: number;
  projectId?: string;
  category?: ExpenseCategory;
  /**
   * `undefined` means "not decided, ask"; `null` means "decided, there is no
   * note"; a string is the note. A one-line entry always decides this, so it
   * never gets re-prompted for a note it already answered.
   */
  description?: string | null;
};

/**
 * Everything the conversation needs to start. It is a single serializable
 * object because `ctx.conversation.enter` replays it on every update; the
 * invoice rides as a `fileId` descriptor, never as bytes.
 */
export type ExpenseEntry = {
  origin?: GroupOrigin;
  prefill?: ExpensePrefill;
  /** A photo sent before the flow: downloaded once and the invoice step skipped. */
  invoice?: InvoiceMedia;
  /**
   * The user's line had a project and/or category but no amount. The flow opens
   * by restating what it understood and waiting for the «ادامه با دکمهها»
   * button, so nothing is guessed and nothing is asked twice.
   */
  awaitContinue?: boolean;
  /**
   * A text-only entry can carry no photo, so the optional invoice step is
   * dropped rather than forcing a tap on "skip".
   */
  skipInvoice?: boolean;
};

/** A still-valid previous project/category the shortcut may reuse. */
type Remembered = {
  projectId: string;
  category: ExpenseCategory;
  projectName: string;
};

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
 * replay state, and the summary's edit loop re-registers steps, so each round
 * suffixes its keys. Invalid input is handled by `otherwise`, which re-prompts
 * without consuming a turn of the conversation.
 *
 * The entry snapshot (user + project list + remembered choice) is resolved once
 * via `conv.external` and reused on replays. Without this, re-resolving the
 * project list on every replay would re-authorize the earlier pick: if access
 * is revoked mid-flow, the replay would abort with "pick again" instead of
 * reaching the write-time check in `createExpense`, which is what must refuse
 * the write and explain why.
 */
export const expenseConversation = createConversation<Ctx, Context>(
  async (conv, ctx, entry: ExpenseEntry = {}) => {
    if (!ctx.from) return;

    const origin = entry.origin ?? null;

    const snapshot = await conv.external(async () => {
      try {
        const user = await findTelegramUser(ctx.from!.id);
        if (!user) return { error: "unknown-user" } as const;
        // A deactivated account keeps its history but may not record anything
        // more, so it is refused here rather than shown an empty project list.
        if (!user.isActive) return { error: "inactive" } as const;
        const projects = (await listProjectsForUser(user.id)).map((p) => ({
          id: p.id,
          name: p.name,
        }));
        // The remembered pair is offered only while the project is still among
        // the ones this user may record on (which already excludes inactive
        // projects and revoked links).
        const rememberedProject =
          user.lastProjectId && user.lastCategory
            ? projects.find((p) => p.id === user.lastProjectId)
            : undefined;
        const remembered: Remembered | null =
          rememberedProject && user.lastCategory
            ? {
                projectId: rememberedProject.id,
                category: user.lastCategory,
                projectName: rememberedProject.name,
              }
            : null;
        return { userId: user.id, projects, remembered };
      } catch (error) {
        // A dying database mid-conversation must surface as a message, not as
        // a silent drop. The global error handler would only log it.
        telegramWarn("conversation entry could not be resolved", error);
        return { error: "unavailable" } as const;
      }
    });
    if ("error" in snapshot) {
      const reply =
        snapshot.error === "unavailable"
          ? MESSAGES.genericError
          : snapshot.error === "inactive"
            ? MESSAGES.noAccess
            : MESSAGES.notRegistered;
      await ctx.reply(reply);
      return;
    }
    if (snapshot.projects.length === 0) {
      await ctx.reply(MESSAGES.noProjects);
      return;
    }

    // Captured after the guard: control-flow narrowing does not reach into the
    // nested step helpers below.
    const projects = snapshot.projects;
    const userId = snapshot.userId;
    const remembered = snapshot.remembered;

    const projectNameOf = (projectId: string) =>
      projects.find((p) => p.id === projectId)?.name ?? "—";

    /**
     * One round-trip per field. Each is a small reusable unit so the summary's
     * "edit" action can redo a single field without replaying the others.
     * `suffix` keeps collation keys unique across the initial run and every
     * edit round.
     */
    async function askProject(
      suffix: string,
    ): Promise<
      | { projectId: string; useLast?: undefined }
      | { useLast: true; projectId?: undefined }
      | null
    > {
      await ctx.reply(
        remembered
          ? `${MESSAGES.pickProject}\n\n${lastChoiceHint(
              remembered.projectName,
              categoryLabel(remembered.category),
            )}`
          : MESSAGES.pickProject,
        {
          reply_markup: projectKeyboard(
            projects,
            remembered
              ? {
                  label: lastChoiceShortcut(
                    remembered.projectName,
                    categoryLabel(remembered.category),
                  ),
                  data: CALLBACK.lastChoice,
                }
              : undefined,
          ),
        },
      );
      const step = await conv.waitForCallbackQuery(PROJECT_OR_LAST_PATTERN, {
        ...waitOptions(),
        collationKey: `project:${suffix}`,
        otherwise: (c) => c.reply(MESSAGES.pickProjectAgain),
      });
      await step.answerCallbackQuery();

      // The shortcut is only offered when `remembered` exists; re-check the data
      // so a stale/forged press can never select an unknown project.
      if (
        step.callbackQuery?.data === CALLBACK.lastChoice &&
        remembered !== null
      ) {
        return { useLast: true };
      }

      const projectId = step.match?.[1];
      if (!projectId) {
        await ctx.reply(MESSAGES.pickProjectAgain);
        return null;
      }
      // The picked id is taken as-is: authorization is enforced at write time
      // by `createExpense`, not by re-checking the current project list here.
      return { projectId };
    }

    async function askCategory(
      suffix: string,
    ): Promise<ExpenseCategory | null> {
      await ctx.reply(MESSAGES.pickCategory, {
        reply_markup: categoryKeyboard(),
      });
      const step = await conv.waitForCallbackQuery(CATEGORY_PATTERN, {
        ...waitOptions(),
        collationKey: `category:${suffix}`,
        otherwise: (c) => c.reply(MESSAGES.pickCategoryAgain),
      });
      await step.answerCallbackQuery();
      const category = parseCategory(step.match[1]) as ExpenseCategory | null;
      if (!category) {
        await ctx.reply(MESSAGES.pickCategoryAgain);
        return null;
      }
      return category;
    }

    async function askAmount(suffix: string): Promise<number | null> {
      await ctx.reply(MESSAGES.enterAmount, { reply_markup: cancelKeyboard() });
      const step = await conv.waitUntil(
        (c) => !!c.msg?.text && parseAmount(c.msg.text) !== null,
        {
          ...waitOptions(),
          collationKey: `amount:${suffix}`,
          otherwise: (c) => c.reply(MESSAGES.invalidAmount),
        },
      );
      const amount = parseAmount(step.msg?.text ?? "");
      if (amount === null) {
        await ctx.reply(MESSAGES.invalidAmount);
        return null;
      }
      return amount;
    }

    async function askDescription(
      suffix: string,
    ): Promise<{ ok: boolean; value?: string }> {
      await ctx.reply(MESSAGES.askDescription, {
        reply_markup: skipDescriptionKeyboard(),
      });
      // A note is optional, so the step is satisfied either by the skip button
      // or by any text the core schema would accept. The button arrives as a
      // callback query, never as a message, so it cannot be mistaken for a note.
      const step = await conv.waitUntil(
        (c) =>
          c.callbackQuery?.data === CALLBACK.skipDescription ||
          (!!c.msg?.text && parseDescription(c.msg.text) !== null),
        {
          ...waitOptions(),
          collationKey: `description:${suffix}`,
          otherwise: (c) =>
            c.reply(
              c.msg?.text
                ? MESSAGES.descriptionTooLong
                : MESSAGES.descriptionAgain,
            ),
        },
      );

      if (step.callbackQuery?.data === CALLBACK.skipDescription) {
        await step.answerCallbackQuery();
        return { ok: true, value: undefined };
      }
      const text = parseDescription(step.msg?.text ?? "");
      if (text === null) {
        // Unreachable while the predicate holds, so the user is re-prompted
        // rather than silently truncated.
        await step.reply(MESSAGES.descriptionTooLong);
        return { ok: false };
      }
      // Whitespace-only input trims to "", which means "no note".
      return { ok: true, value: text || undefined };
    }

    async function askInvoice(
      suffix: string,
    ): Promise<{ ok: boolean; invoice: Invoice | null }> {
      await ctx.reply(MESSAGES.askInvoice, {
        reply_markup: skipInvoiceKeyboard(),
      });
      const step = await conv.waitUntil(
        (c) =>
          c.callbackQuery?.data === CALLBACK.skipInvoice ||
          hasInvoiceMedia(c.msg),
        {
          ...waitOptions(),
          collationKey: `invoice:${suffix}`,
          otherwise: (c) => c.reply(MESSAGES.askInvoiceAgain),
        },
      );

      if (step.callbackQuery?.data === CALLBACK.skipInvoice) {
        telegramLog("invoice skipped by the user");
        await step.answerCallbackQuery();
        return { ok: true, invoice: null };
      }

      try {
        // Both a plain photo and a document are accepted: Telegram delivers the
        // first as `photo` and the second as `document`, and only the message
        // itself knows which one it is.
        const invoice = await downloadInvoiceMedia(step.api, step.msg!);
        telegramLog("invoice accepted");
        await step.reply("✅ فاکتور دریافت شد.");
        return { ok: true, invoice };
      } catch (error) {
        telegramWarn("invoice rejected", error);
        await step.reply(failedWithRetry(reasonOf(error)));
        // A rejected document degrades to "no invoice", matching the original
        // flow: the refusal is announced, then the expense is still written.
        return { ok: true, invoice: null };
      }
    }

    const prefill = entry.prefill ?? {};
    const prefillProjectId =
      prefill.projectId && projects.some((p) => p.id === prefill.projectId)
        ? prefill.projectId
        : "";

    const chosen: {
      projectId: string;
      category?: ExpenseCategory;
      amount: number;
      description?: string | null;
      invoice: Invoice | null;
    } = {
      projectId: prefillProjectId,
      category: prefill.category,
      amount: prefill.amount ?? 0,
      description: prefill.description,
      invoice: null,
    };

    // A line that named a project/category but no amount stops here first: the
    // bot restates what it understood and waits for a tap, so the user sees the
    // interpretation before being asked for the missing pieces.
    if (entry.awaitContinue) {
      await ctx.reply(
        quickUnderstoodLines({
          amount:
            chosen.amount > 0 ? formatAmount(BigInt(chosen.amount)) : null,
          projectName: chosen.projectId ? projectNameOf(chosen.projectId) : null,
          category: chosen.category ? categoryLabel(chosen.category) : null,
          description: chosen.description ?? null,
        }),
        { reply_markup: quickContinueKeyboard() },
      );
      const go = await conv.waitForCallbackQuery(CALLBACK.quickContinue, {
        ...waitOptions(),
        collationKey: "quick:continue",
        otherwise: (c) => c.reply(MESSAGES.unexpected),
      });
      await go.answerCallbackQuery();
    }

    // A photo sent before the flow started is downloaded once here, so the
    // invoice step is skipped. A rejected one degrades to asking again.
    let invoiceReady = false;
    if (entry.invoice) {
      try {
        chosen.invoice = await downloadInvoice(ctx.api, entry.invoice);
        invoiceReady = true;
        telegramLog("pre-attached invoice accepted");
        await ctx.reply("✅ فاکتور دریافت شد.");
      } catch (error) {
        telegramWarn("pre-attached invoice rejected", error);
        await ctx.reply(failedWithRetry(reasonOf(error)));
      }
    }

    if (!chosen.projectId) {
      const project = await askProject("0");
      if (project === null) return;
      if (project.useLast) {
        // Guaranteed non-null: the shortcut only exists when remembered does.
        chosen.projectId = remembered!.projectId;
        chosen.category = remembered!.category;
      } else {
        chosen.projectId = project.projectId;
      }
    }

    if (!chosen.category) {
      const category = await askCategory("0");
      if (category === null) return;
      chosen.category = category;
    }

    if (chosen.amount === 0) {
      const amount = await askAmount("0");
      if (amount === null) return;
      chosen.amount = amount;
    }

    if (chosen.description === undefined) {
      const description = await askDescription("0");
      if (!description.ok) return;
      chosen.description = description.value ?? null;
    }

    if (!invoiceReady && !entry.skipInvoice) {
      const invoiceAnswer = await askInvoice("0");
      if (!invoiceAnswer.ok) return;
      chosen.invoice = invoiceAnswer.invoice;
    }

    // The summary/confirm step. Nothing is written until the user approves, so
    // a wrong amount or a missed note is caught before it reaches the books.
    let approved = false;
    for (let round = 0; round < MAX_CONFIRM_ROUNDS && !approved; round++) {
      await ctx.reply(
        expenseSummaryForConfirm({
          projectName: projectNameOf(chosen.projectId),
          category: categoryLabel(chosen.category!),
          amount: formatAmount(BigInt(chosen.amount)),
          description: chosen.description,
          hasInvoice: chosen.invoice !== null,
        }),
        { reply_markup: confirmKeyboard() },
      );

      const step = await conv.waitForCallbackQuery(CONFIRM_PATTERN, {
        ...waitOptions(),
        collationKey: `confirm:${round}`,
        otherwise: (c) => c.reply(MESSAGES.confirmAgain),
      });
      await step.answerCallbackQuery();
      const action = step.match[1];

      if (action === "cancel") {
        await ctx.reply(MESSAGES.cancelled);
        return;
      }
      if (action === "approve") {
        approved = true;
        break;
      }

      // action === "edit": pick a field, redo just that one, then re-show the
      // summary on the next pass.
      await ctx.reply(MESSAGES.pickEditField, {
        reply_markup: editFieldsKeyboard(),
      });
      const fieldStep = await conv.waitForCallbackQuery(EDIT_FIELD_PATTERN, {
        ...waitOptions(),
        collationKey: `editfield:${round}`,
        otherwise: (c) => c.reply(MESSAGES.pickEditFieldAgain),
      });
      await fieldStep.answerCallbackQuery();
      const field = fieldStep.match[1];

      if (field === "project") {
        const value = await askProject(`e${round}`);
        if (value !== null) {
          if (value.useLast && remembered) {
            chosen.projectId = remembered.projectId;
            chosen.category = remembered.category;
          } else if (value.projectId) {
            chosen.projectId = value.projectId;
          }
        }
      } else if (field === "category") {
        const value = await askCategory(`e${round}`);
        if (value !== null) chosen.category = value;
      } else if (field === "amount") {
        const value = await askAmount(`e${round}`);
        if (value !== null) chosen.amount = value;
      } else if (field === "description") {
        const value = await askDescription(`e${round}`);
        if (value.ok) chosen.description = value.value ?? null;
      }
    }

    let expense;
    try {
      expense = await createExpense({
        projectId: chosen.projectId,
        userId: userId,
        category: chosen.category!,
        amount: chosen.amount,
        description: chosen.description ?? undefined,
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
    let stored: string | null = null;
    if (chosen.invoice) {
      try {
        stored = await saveInvoiceFile({
          buffer: chosen.invoice.buffer,
          mimeType: chosen.invoice.mimeType,
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

    // The self-cancel button is shown only while cancellation is possible, so
    // the user is never offered an action the server would refuse.
    const cancellation = await getCancellationSettings();
    await ctx.reply(
      savedConfirmation({
        projectName: expense.project.name,
        category: categoryLabel(expense.category),
        amount: formatAmount(expense.amount),
        invoiceNumber: expense.invoiceNumber,
        hasInvoice,
        description: expense.description,
      }),
      {
        ...(cancellation.windowMinutes > 0
          ? { reply_markup: selfCancelKeyboard(expense.id) }
          : {}),
      },
    );

    // The expense is committed above; announcing it is a separate, best-effort
    // side effect. A closed group, a rate limit or a removed bot is logged and
    // related to the user, but can never fail or roll back the saved expense.
    //
    // A group-originated flow announces to its origin group; a direct private
    // flow (origin is null) announces to every linked group while the setting
    // allows it.
    try {
      const outcome = await announceExpense(ctx.api, {
        originChatId: origin?.groupChatId ?? null,
        expense: {
          userName: expense.user.name,
          projectName: expense.project.name,
          category: expense.category,
          amount: expense.amount,
          description: expense.description,
          invoiceNumber: expense.invoiceNumber,
          invoiceFilePath: hasInvoice ? stored : null,
        },
      });

      // Remember where it went so a later correction can be posted there too.
      if (outcome.sent.length > 0) {
        try {
          await recordExpenseAnnouncement(expense.id, outcome.sent);
        } catch (error) {
          telegramWarn("could not record the announcement group(s)", error);
        }
      }
      if (outcome.failed > 0) {
        await ctx.reply(MESSAGES.groupAnnounceFailed);
      }
    } catch (error) {
      telegramWarn("group announcement failed", error);
      await ctx.reply(MESSAGES.groupAnnounceFailed);
    }
  },
  { id: CONVERSATION_ID },
);
