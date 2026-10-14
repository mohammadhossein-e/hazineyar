import { announceExpenseCorrection } from "@/adapters/telegram/announce";
import { createTelegramChatNotifier } from "@/adapters/telegram/notifier";
import { parseAnnouncedChats } from "@/core/expenses/announcement";
import type { ExpenseWithRelations } from "@/core/expenses/presenter";

/**
 * Best-effort correction notice to the group an expense was announced in.
 *
 * The correction has already been committed when this runs, so a failure is
 * logged and swallowed: the dashboard's write must never be reported as failed
 * just because Telegram was unreachable or the group was unlinked.
 */
export async function notifyGroupOfCorrection(
  expense: ExpenseWithRelations,
  action: "edit" | "delete" | "cancel" | "restore",
  reason?: string | null,
): Promise<void> {
  try {
    await announceExpenseCorrection(
      createTelegramChatNotifier(),
      {
        announcedChats: parseAnnouncedChats(expense.announcedChats),
        userName: expense.user.name,
        projectName: expense.project.name,
        category: expense.category,
        amount: expense.amount,
      },
      action,
      { reason },
    );
  } catch (error) {
    console.warn(`[expenses] group correction notice failed (${action}):`, error);
  }
}
