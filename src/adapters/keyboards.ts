import { InlineKeyboard } from "grammy";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/core/expenses/categories";
import { CALLBACK } from "./keys";
import { MESSAGES, selfCancelButton } from "./messages";

function withCancel(build: (keyboard: InlineKeyboard) => void): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  build(keyboard);
  keyboard.row();
  keyboard.text(MESSAGES.cancel, CALLBACK.cancel);
  return keyboard;
}

/**
 * Callback data is capped at 64 bytes by Telegram (and Bale). Cuid ids plus the
 * prefix stay well under that; project names travel as button text, not payload.
 *
 * `shortcut` is the one-tap "same project/category as last time" button. It is
 * placed first so it is the most prominent choice, and only when the flow has a
 * still-valid remembered pair to reuse.
 */
export function projectKeyboard(
  projects: { id: string; name: string }[],
  shortcut?: { label: string; data: string },
): InlineKeyboard {
  return withCancel((keyboard) => {
    if (shortcut) {
      keyboard.text(shortcut.label, shortcut.data).row();
    }
    for (const project of projects) {
      keyboard.text(project.name, `${CALLBACK.project}${project.id}`);
    }
  });
}

/** One-line entry with a project/category but no amount: continue manually. */
export function quickContinueKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    MESSAGES.quickContinue,
    CALLBACK.quickContinue,
  );
}

export function categoryKeyboard(): InlineKeyboard {
  return withCancel((keyboard) => {
    for (const category of ALL_CATEGORIES) {
      keyboard.text(
        CATEGORY_LABELS[category],
        `${CALLBACK.category}${category}`,
      );
    }
  });
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(MESSAGES.cancel, CALLBACK.cancel);
}

export function skipDescriptionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(MESSAGES.skipDescription, CALLBACK.skipDescription)
    .row()
    .text(MESSAGES.cancel, CALLBACK.cancel);
}

export function skipInvoiceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(MESSAGES.skipInvoice, CALLBACK.skipInvoice)
    .row()
    .text(MESSAGES.cancel, CALLBACK.cancel);
}

export function retryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(MESSAGES.retry, CALLBACK.retry)
    .row()
    .text(MESSAGES.cancel, CALLBACK.cancel);
}

/** Summary step: approve, edit one field, or drop the whole flow. */
export function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(MESSAGES.confirm, `${CALLBACK.confirm}approve`)
    .text(MESSAGES.editExpense, `${CALLBACK.confirm}edit`)
    .row()
    .text(MESSAGES.cancelExpense, `${CALLBACK.confirm}cancel`);
}

/** Which field the user wants to redo at the summary step. */
export function editFieldsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(MESSAGES.editProject, `${CALLBACK.editField}project`)
    .text(MESSAGES.editCategory, `${CALLBACK.editField}category`)
    .row()
    .text(MESSAGES.editAmount, `${CALLBACK.editField}amount`)
    .text(MESSAGES.editDescription, `${CALLBACK.editField}description`);
}

/**
 * The self-cancel button on the saved confirmation. It is a callback (not a
 * deep link) and carries the expense id, since the bot has to check ownership
 * and the window server-side.
 */
export function selfCancelKeyboard(expenseId: string): InlineKeyboard {
  return new InlineKeyboard().text(
    selfCancelButton(),
    `${CALLBACK.selfCancel}${expenseId}`,
  );
}

/**
 * The group-mode button. It is a URL button (not a callback), because the
 * guided flow must run in the private chat; the payload carries the origin
 * group so the finished expense can be announced back to it.
 *
 * The full deep link is built by the caller through the channel's `chatLink`,
 * so this stays free of any network-specific host.
 */
export function startPrivateKeyboard(url: string, label: string): InlineKeyboard {
  return new InlineKeyboard().url(label, url);
}
