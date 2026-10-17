import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { redactValue } from "@/lib/redact";
import { toChannelId } from "../channels";
import { NotFoundError, ValidationError } from "../errors";
import type { Notifier } from "../notify";
import { createStaffUser, duplicateNameWarning } from "../users/service";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  PENDING_REQUEST_CAP,
  REJECTED_REQUEST_PAGE_SIZE,
} from "./schemas";

/**
 * What the bot should tell the sender after they ask for access.
 *  - `requested` — a pending row exists (created or refreshed)
 *  - `rejected`  — the admin said no; nothing changes on a repeat message
 *  - `busy`      — the pending queue is full; no row was created
 */
export type AccessRequestOutcome = "requested" | "rejected" | "busy";

/**
 * Display names come straight from Telegram, so they are trimmed of control
 * characters and newlines and hard-capped. HTML escaping happens where the
 * value is rendered (React escapes by default), not here.
 */
export function sanitizeDisplayName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_DISPLAY_NAME_LENGTH) || "کاربر";
}

/** Usernames are optional and normalized to the bare handle, without `@`. */
export function sanitizeUsername(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, MAX_USERNAME_LENGTH);
  return cleaned || null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Records (or refreshes) an access request for an unknown user.
 *
 * Idempotent by (channel, externalId): repeated `/start` or `/expense`
 * messages refresh the same row and never duplicate it. A rejected user is
 * left rejected — the bot cannot re-open a decision from the chat. Overflow
 * past the pending cap is dropped without creating anything.
 */
export async function recordAccessRequest(input: {
  channel: string;
  externalId: string;
  displayName: string;
  username?: string | null;
}): Promise<AccessRequestOutcome> {
  const channel = input.channel;
  const externalId = input.externalId;
  const displayName = sanitizeDisplayName(input.displayName);
  const username = sanitizeUsername(input.username);

  const existing = await prisma.accessRequest.findUnique({
    where: { channel_externalId: { channel, externalId } },
  });

  if (existing) {
    if (existing.status === "REJECTED") return "rejected";
    if (existing.status === "PENDING") {
      await prisma.accessRequest.update({
        where: { id: existing.id },
        data: { displayName, username },
      });
      return "requested";
    }
    // APPROVED, yet the bot could not find a User: the account was removed by
    // hand, so the request is re-opened (if the queue has room).
    const pending = await prisma.accessRequest.count({
      where: { status: "PENDING" },
    });
    if (pending >= PENDING_REQUEST_CAP) return "busy";
    await prisma.accessRequest.update({
      where: { id: existing.id },
      data: { status: "PENDING", decidedAt: null, displayName, username },
    });
    return "requested";
  }

  const pending = await prisma.accessRequest.count({
    where: { status: "PENDING" },
  });
  if (pending >= PENDING_REQUEST_CAP) return "busy";

  try {
    await prisma.accessRequest.create({
      data: { channel, externalId, displayName, username },
    });
  } catch (error) {
    // Two messages from the same user raced; the row exists now, which is all
    // the caller needs. Anything else is a real failure.
    if (!isUniqueViolation(error)) throw error;
  }
  return "requested";
}

/** A single request by id, or null. Used to route the approval notice. */
export async function getAccessRequestById(id: string) {
  return prisma.accessRequest.findUnique({ where: { id } });
}

export async function listPendingAccessRequests() {
  return prisma.accessRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

/** Cheap count for the header/drawer badge, without loading the rows. */
export async function countPendingAccessRequests(): Promise<number> {
  return prisma.accessRequest.count({ where: { status: "PENDING" } });
}

/** Recent rejections, newest first, so an admin can change their mind. */
export async function listRejectedAccessRequests(
  limit = REJECTED_REQUEST_PAGE_SIZE,
) {
  return prisma.accessRequest.findMany({
    where: { status: "REJECTED" },
    orderBy: { decidedAt: "desc" },
    take: limit,
  });
}

export function approvalMessage(name: string): string {
  return [
    `سلام ${name} عزیز ✅`,
    "دسترسی شما در سامانه ثبت هزینه تایید شد.",
    "حالا می‌توانید با دستور /expense هزینه جدید ثبت کنید.",
  ].join("\n");
}

/**
 * Approves a pending (or previously rejected) request: it creates the actual
 * User through `createStaffUser`, so the duplicate-id, name and project
 * validation is exactly the manual form's, then flips the request to APPROVED.
 *
 * The user is notified over an injected `Notifier`. A failure there (the user
 * blocked the bot, Telegram is down) is logged and reported back as
 * `notified: false`; it must never undo the approval.
 */
export async function approveAccessRequest(
  input: { id: string; name?: string; role: Role; projectIds: string[] },
  notifier?: Notifier | null,
): Promise<{
  user: Awaited<ReturnType<typeof createStaffUser>>;
  notified: boolean;
  warning?: string;
}> {
  const request = await prisma.accessRequest.findUnique({
    where: { id: input.id },
  });
  if (!request) throw new NotFoundError("درخواست دسترسی یافت نشد");
  if (request.status === "APPROVED") {
    throw new ValidationError("این درخواست قبلاً تایید شده است");
  }

  // The manager's chosen name wins; the recorded display name is only the
  // fallback (and stays on the request for reference). The account is created
  // on the network the request actually came from, so the bot can resolve it.
  const user = await createStaffUser({
    name: input.name?.trim() || request.displayName,
    channel: toChannelId(request.channel),
    externalId: request.externalId,
    role: input.role,
    projectIds: input.projectIds,
  });

  await prisma.accessRequest.update({
    where: { id: request.id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });

  // Names are not unique, but a clash is worth flagging softly to the manager.
  const warning = await duplicateNameWarning(user.name, user.id);

  let notified = false;
  if (notifier) {
    try {
      await notifier.notifyUser(request.externalId, approvalMessage(user.name));
      notified = true;
    } catch (error) {
      console.warn(
        `[access] could not notify ${request.externalId} after approval:`,
        redactValue(error, config.secretTokens),
      );
    }
  }

  return { user, notified, ...(warning ? { warning } : {}) };
}

/** Rejecting is idempotent: rejecting an already-rejected row is a no-op. */
export async function rejectAccessRequest(id: string) {
  const request = await prisma.accessRequest.findUnique({ where: { id } });
  if (!request) throw new NotFoundError("درخواست دسترسی یافت نشد");
  if (request.status === "APPROVED") {
    throw new ValidationError("درخواست تاییدشده را نمی‌توان رد کرد");
  }
  if (request.status === "REJECTED") return request;
  return prisma.accessRequest.update({
    where: { id },
    data: { status: "REJECTED", decidedAt: new Date() },
  });
}
