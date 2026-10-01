import type { User } from "@prisma/client";
import { getUserByChannel } from "@/core/users/service";

/**
 * Telegram users are matched by their immutable numeric id. A Telegram id is
 * never registered on the fly: an unknown id means the admin has not granted
 * access yet, and the bot says so instead of creating a row.
 */
export async function findTelegramUser(
  telegramUserId: number,
): Promise<User | null> {
  return getUserByChannel("telegram", String(telegramUserId));
}
