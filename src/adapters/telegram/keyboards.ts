import { InlineKeyboard } from "grammy";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/core/expenses/categories";
import { CALLBACK } from "./keys";
import { MESSAGES } from "./messages";

function withCancel(build: (keyboard: InlineKeyboard) => void): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  build(keyboard);
  keyboard.row();
  keyboard.text(MESSAGES.cancel, CALLBACK.cancel);
  return keyboard;
}

/**
 * Callback data is capped at 64 bytes by Telegram. Cuid ids plus the prefix
 * stay well under that; project names travel as button text, not payload.
 */
export function projectKeyboard(
  projects: { id: string; name: string }[],
): InlineKeyboard {
  return withCancel((keyboard) => {
    for (const project of projects) {
      keyboard.text(project.name, `${CALLBACK.project}${project.id}`);
    }
  });
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
