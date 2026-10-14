import { z } from "zod";
import { roleSchema, userNameSchema } from "../users/schemas";

/** Mirrors the user-name limit, so an approved request's name always fits. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Telegram usernames are short; the cap just keeps hostile input bounded. */
export const MAX_USERNAME_LENGTH = 64;

/**
 * The access list is a queue a human has to clear, not a mailbox. A flood of
 * pending rows is dropped on the floor rather than shown to the admin.
 */
export const PENDING_REQUEST_CAP = 100;

/** The most recent rejected rows shown so an admin can re-open one. */
export const REJECTED_REQUEST_PAGE_SIZE = 20;

export const accessRequestIdSchema = z
  .string()
  .min(1, "شناسه درخواست الزامی است");

/**
 * The data the bot has about a Telegram user. It is sanitized in the service
 * before it is stored; the dashboard escapes it again when rendering.
 */
export const recordAccessRequestSchema = z.object({
  channel: z.string().min(1),
  externalId: z.string().min(1),
  displayName: z.string(),
  username: z.string().nullish(),
});

/**
 * Approval reuses the exact same name/role/project validation as the manual
 * "add user" form. `name` may be omitted, in which case the recorded display
 * name is used.
 */
export const approveAccessRequestSchema = z.object({
  name: userNameSchema.optional(),
  role: roleSchema.default("EMPLOYEE"),
  projectIds: z.array(z.string().min(1)).max(100).default([]),
});

export type ApproveAccessRequestInput = z.input<
  typeof approveAccessRequestSchema
>;
