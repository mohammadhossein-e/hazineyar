import { InputFile, type Api } from "grammy";
import type { ExpenseCategory } from "@prisma/client";
import { categoryLabel } from "@/core/expenses/categories";
import type { AnnouncedChat } from "@/core/expenses/announcement";
import type { ChatNotifier } from "@/core/notify";
import { getLinkedChat, listLinkedChats } from "@/core/chats/service";
import type { AnnounceMode } from "@/core/settings/schemas";
import { getAnnouncementSettings } from "@/core/settings/service";
import { readInvoiceFile } from "@/lib/uploads";
import type { ChannelConfig } from "./channel";
import { formatAmount } from "./format";
import { correctionNotice } from "./messages";

export type AnnouncementExpense = {
  userName: string;
  projectName: string;
  category: ExpenseCategory;
  amount: bigint;
  description?: string | null;
  invoiceNumber: string;
  invoiceFilePath?: string | null;
};

/**
 * The result of trying to announce one expense.
 *
 * `sent` lists the groups that actually received it (remembered on the expense
 * so a later correction reaches the same places), `failed` counts the targets
 * that were attempted but rejected, and `skipped` means there was deliberately
 * nothing to send (mode OFF, direct announcements off, no linked group, or the
 * origin group is no longer linked).
 *
 * A send failure is never thrown: the expense is already saved, so the caller
 * only has to warn the user. This also lets a partial success (one of several
 * linked groups) be reported rather than lost.
 */
export type AnnounceOutcome = {
  sent: AnnouncedChat[];
  failed: number;
  skipped: boolean;
};

export type Announcer = (
  api: Api,
  request: { originChatId: string | null; expense: AnnouncementExpense },
) => Promise<AnnounceOutcome>;

/**
 * The default (FULL) shape is:
 *   ✅ رضا یک هزینه ثبت کرد: سعادت‌آباد | مصالح | 12,500,000 تومان | توضیحات | invoice_003
 * MINIMAL drops everything but who and where.
 */
export function buildAnnouncementText(
  mode: AnnounceMode,
  expense: AnnouncementExpense,
): string {
  if (mode === "OFF") return "";
  if (mode === "MINIMAL") {
    return `✅ ثبت شد: ${expense.userName} | ${expense.projectName}`;
  }

  const segments = [
    expense.projectName,
    categoryLabel(expense.category),
    `${formatAmount(expense.amount)} تومان`,
  ];
  if (expense.description) segments.push(expense.description);
  segments.push(expense.invoiceNumber);

  return `✅ ${expense.userName} یک هزینه ثبت کرد: ${segments.join(" | ")}`;
}

/** Posts the announcement to one chat and returns the message id. */
async function deliverToChat(
  api: Api,
  chatId: string,
  mode: AnnounceMode,
  includeInvoice: boolean,
  expense: AnnouncementExpense,
  warn: (message: string, detail?: unknown) => void,
): Promise<number> {
  const text = buildAnnouncementText(mode, expense);

  if (includeInvoice && expense.invoiceFilePath) {
    let file: Awaited<ReturnType<typeof readInvoiceFile>> | null = null;
    try {
      file = await readInvoiceFile(expense.invoiceFilePath);
    } catch (error) {
      // The image is optional; the text still goes out rather than failing.
      warn("invoice file could not be read for the announcement", error);
    }

    if (file) {
      const message = await api.sendDocument(
        chatId,
        new InputFile(file.buffer, expense.invoiceFilePath),
        { caption: text },
      );
      return message.message_id;
    }
  }

  const message = await api.sendMessage(chatId, text);
  return message.message_id;
}

/**
 * Announces an expense to the group(s) it belongs to.
 *
 * A group-originated expense (the flow started from a deep link) only ever goes
 * to that origin group. A direct/private expense — where `originChatId` is null
 * — goes to every linked group, but only while the `announceDirectExpenses`
 * setting is on; with no linked group it is silently skipped with a log line.
 *
 * The target list is read fresh here: the admin may have linked or unlinked a
 * group while the flow was running, and a stale reference must not reach an
 * arbitrary chat. Each target is sent independently, so one failing group does
 * not stop the others and never fails the already-saved expense.
 *
 * The channel is injected so a network with no group support (Bale) simply has
 * no linked chats and therefore announces nothing.
 */
export function createAnnouncer(
  channel: ChannelConfig,
  log: (message: string, detail?: unknown) => void,
  warn: (message: string, detail?: unknown) => void,
): Announcer {
  return async (api, request) => {
    const { originChatId, expense } = request;
    const settings = await getAnnouncementSettings();

    if (settings.announceMode === "OFF") {
      log(`group announcement is off; nothing sent for ${expense.invoiceNumber}`);
      return { sent: [], failed: 0, skipped: true };
    }

    let targets: string[];
    if (originChatId) {
      const linked = await getLinkedChat(channel.id, originChatId);
      if (!linked) {
        warn(
          `group ${originChatId} is no longer linked; skipping the announcement`,
        );
        return { sent: [], failed: 0, skipped: true };
      }
      targets = [originChatId];
    } else {
      if (!settings.announceDirectExpenses) {
        log(
          `direct expense announcements are off; nothing sent for ${expense.invoiceNumber}`,
        );
        return { sent: [], failed: 0, skipped: true };
      }
      const linked = await listLinkedChats(channel.id);
      if (linked.length === 0) {
        log(
          `no linked group to announce ${expense.invoiceNumber} to; skipping`,
        );
        return { sent: [], failed: 0, skipped: true };
      }
      targets = linked.map((chat) => chat.externalChatId);
    }

    const sent: AnnouncedChat[] = [];
    let failed = 0;

    for (const chatId of targets) {
      try {
        const messageId = await deliverToChat(
          api,
          chatId,
          settings.announceMode,
          settings.includeInvoice,
          expense,
          warn,
        );
        sent.push({ chatId, messageId });
        log(`announced ${expense.invoiceNumber} to chat ${chatId}`);
      } catch (error) {
        failed += 1;
        warn(
          `failed to announce ${expense.invoiceNumber} to chat ${chatId}`,
          error,
        );
      }
    }

    return { sent, failed, skipped: false };
  };
}

export type CorrectionAction = "edit" | "delete" | "cancel" | "restore";

export type CorrectionExpense = {
  /** The groups the expense was announced in; empty means it never was. */
  announcedChats: AnnouncedChat[];
  userName: string;
  projectName: string;
  category: ExpenseCategory;
  amount: bigint;
};

export type CorrectionOutcome = {
  /** The linked groups the notice was actually posted to. */
  sent: string[];
  skipped: boolean;
};

export type CorrectionAnnouncer = (
  notifier: ChatNotifier,
  expense: CorrectionExpense,
  action: CorrectionAction,
  options?: { reason?: string | null },
) => Promise<CorrectionOutcome>;

/**
 * Posts a short notice about a correction to every group the expense was
 * announced in. Like the original announcement it is best-effort: it never
 * throws for a "nothing to do" case, and one unreachable group does not stop
 * the others. The caller logs a real send failure but must not roll back the
 * correction, which has already been committed.
 *
 * A notice only goes to a group that saw the original and is still linked;
 * `announceMode` is honoured so an OFF/MINIMAL group does not suddenly receive
 * details it never got.
 */
export function createCorrectionAnnouncer(
  channel: ChannelConfig,
  log: (message: string, detail?: unknown) => void,
  warn: (message: string, detail?: unknown) => void,
): CorrectionAnnouncer {
  return async (notifier, expense, action, options = {}) => {
    const chats = expense.announcedChats;
    if (chats.length === 0) {
      log(`no announcement group on the expense; ${action} not announced`);
      return { sent: [], skipped: true };
    }

    const settings = await getAnnouncementSettings();
    if (settings.announceMode === "OFF") {
      log(`announcements are off; ${action} not announced`);
      return { sent: [], skipped: true };
    }

    const minimal = settings.announceMode === "MINIMAL";
    const text = correctionNotice({
      action,
      userName: expense.userName,
      projectName: expense.projectName,
      amount: minimal ? null : formatAmount(expense.amount),
      category: minimal ? null : categoryLabel(expense.category),
      reason: options.reason ?? null,
    });

    const sent: string[] = [];
    for (const { chatId } of chats) {
      const linked = await getLinkedChat(channel.id, chatId);
      if (!linked) {
        warn(
          `group ${chatId} is no longer linked; skipping the ${action} notice`,
        );
        continue;
      }

      try {
        await notifier.notifyChat(chatId, text);
        sent.push(chatId);
        log(`posted the ${action} notice to chat ${chatId}`);
      } catch (error) {
        warn(`failed to post the ${action} notice to chat ${chatId}`, error);
      }
    }

    return { sent, skipped: sent.length === 0 };
  };
}
