import type { User } from "@prisma/client";
import { getUserByChannel } from "@/core/users/service";

/**
 * Users are matched by (channel, immutable external id). An external id is
 * never registered on the fly: an unknown id means the admin has not granted
 * access yet, and the bot says so instead of creating a row.
 *
 * The channel is bound once here so each adapter gets a plain
 * `(externalId) => User | null` lookup.
 */
export function createUserFinder(
  channel: string,
): (externalId: number) => Promise<User | null> {
  return (externalId) => getUserByChannel(channel, String(externalId));
}
