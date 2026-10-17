export const CONVERSATION_ID = "expense";

/**
 * Prefix on the `/start` deep-link payload that points at a group
 * (`g<absolute chat id>`, all A-Za-z0-9). The referenced chat is always
 * re-checked against LinkedChat before anything is announced.
 */
export const GROUP_PAYLOAD_PREFIX = "g";

export const CALLBACK = {
  project: "project:",
  category: "category:",
  cancel: "flow:cancel",
  skipDescription: "description:skip",
  skipInvoice: "invoice:skip",
  retry: "flow:retry",
  /** Summary step: `confirm:approve` / `confirm:edit` / `confirm:cancel`. */
  confirm: "confirm:",
  /** Which field to change from the summary: `editfield:<field>`. */
  editField: "editfield:",
  /** Self-cancel button on the saved message: `selfcancel:<expenseId>`. */
  selfCancel: "selfcancel:",
  /**
   * The one-tap "same project/category as last time" shortcut offered at the
   * project step. It carries no payload: the remembered values are read from
   * the user row inside the flow and re-validated there.
   */
  lastChoice: "last",
  /** One-line entry without an amount: continue in the guided flow. */
  quickContinue: "quick:continue",
} as const;
