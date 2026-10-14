import { prisma } from "@/lib/db";

export const TELEGRAM_CHANNEL = "telegram";

/** Group titles come from Telegram and are shown back; keep them bounded. */
export const MAX_CHAT_TITLE_LENGTH = 100;

export function sanitizeChatTitle(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_CHAT_TITLE_LENGTH);
}

/**
 * Links a group so the bot is allowed to work in it. Idempotent: running
 * `/linkgroup` twice refreshes the stored title instead of erroring.
 */
export async function linkChat(input: {
  channel: string;
  externalChatId: string;
  title: string;
}) {
  const title = sanitizeChatTitle(input.title);
  return prisma.linkedChat.upsert({
    where: {
      channel_externalChatId: {
        channel: input.channel,
        externalChatId: input.externalChatId,
      },
    },
    create: {
      channel: input.channel,
      externalChatId: input.externalChatId,
      title,
    },
    update: { title },
  });
}

/** Returns true when a link existed and was removed. */
export async function unlinkChat(
  channel: string,
  externalChatId: string,
): Promise<boolean> {
  const result = await prisma.linkedChat.deleteMany({
    where: { channel, externalChatId },
  });
  return result.count > 0;
}

export async function getLinkedChat(
  channel: string,
  externalChatId: string,
) {
  return prisma.linkedChat.findUnique({
    where: { channel_externalChatId: { channel, externalChatId } },
  });
}

export async function listLinkedChats(channel?: string) {
  return prisma.linkedChat.findMany({
    where: channel ? { channel } : undefined,
    orderBy: { createdAt: "asc" },
  });
}
