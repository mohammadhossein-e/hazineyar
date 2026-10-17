import { createExpenseConversations } from "../conversation";
import { announceExpense } from "./announce";
import { telegramLog, telegramWarn } from "./logger";
import { downloadInvoice, downloadInvoiceMedia } from "./media";
import { findTelegramUser } from "./user";

/**
 * The guided flow bound to Telegram. The implementation is shared; this fixes
 * the Telegram user lookup, media toolkit, announcer and logger.
 */
const { conversationsPlugin, expenseConversation } = createExpenseConversations({
  findUser: findTelegramUser,
  media: { downloadInvoice, downloadInvoiceMedia },
  announce: announceExpense,
  log: telegramLog,
  warn: telegramWarn,
});

export { conversationsPlugin, expenseConversation };
export type {
  ExpenseEntry,
  ExpensePrefill,
  GroupOrigin,
} from "../conversation";
