/**
 * An expense announcement can reach more than one group (a direct/private
 * expense is announced to every linked group), so the expense stores a list of
 * the chats that saw it. A later correction is posted back to each of them.
 *
 * The value lives in a JSON column, so it is parsed defensively: a row written
 * by an older version — or hand-edited — must never crash an announcement.
 */
export type AnnouncedChat = {
  chatId: string;
  messageId: number | null;
};

export function parseAnnouncedChats(value: unknown): AnnouncedChat[] {
  if (!Array.isArray(value)) return [];

  const chats: AnnouncedChat[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { chatId?: unknown; messageId?: unknown };
    if (typeof record.chatId !== "string" || record.chatId.length === 0) {
      continue;
    }
    const messageId =
      typeof record.messageId === "number" && Number.isFinite(record.messageId)
        ? record.messageId
        : null;
    chats.push({ chatId: record.chatId, messageId });
  }
  return chats;
}
