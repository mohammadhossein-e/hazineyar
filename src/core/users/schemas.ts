import { z } from "zod";
import { Role } from "@prisma/client";

export const MAX_USER_NAME_LENGTH = 80;

/**
 * A user's external id is a positive integer on both networks, and the bot
 * matches on it exactly.
 */
export const externalIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, "شناسه باید فقط شامل رقم باشد (مثلاً 123456789)");

/** The messaging networks a staff account can belong to. */
export const channelSchema = z.enum(["telegram", "bale"], {
  error: () => ({ message: "پیام‌رسان نامعتبر است" }),
});

export const roleSchema = z.enum(Role, {
  error: () => ({ message: "نقش کاربر نامعتبر است" }),
});

/**
 * C0/C1 control characters plus DEL. Telegram display names can carry newlines
 * or other invisible code points; they would corrupt the rendered table, the
 * Excel cell and the bot greeting, so a manager-typed name must not contain
 * them. (Nobody types these on purpose — this only rejects pasted garbage.)
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export const userNameSchema = z
  .string()
  .trim()
  .min(2, "نام باید حداقل ۲ کاراکتر باشد")
  .max(MAX_USER_NAME_LENGTH, `نام باید حداکثر ${MAX_USER_NAME_LENGTH} کاراکتر باشد`)
  .refine(
    (value) => !CONTROL_CHARACTERS.test(value),
    "نام نمی‌تواند نویسه‌های کنترلی داشته باشد",
  );

/** Body for renaming an existing user: the same rules as creating one. */
export const userNameInputSchema = z.object({ name: userNameSchema });

export const createUserSchema = z.object({
  name: userNameSchema,
  /** Which messaging network the external id belongs to. */
  channel: channelSchema.default("telegram"),
  externalId: externalIdSchema,
  role: roleSchema.default("EMPLOYEE"),
  projectIds: z.array(z.string().min(1)).max(100).default([]),
});

export const userStatusSchema = z.object({
  isActive: z.boolean("وضعیت کاربر باید فعال یا غیرفعال باشد"),
});

/** Replaces the whole set of linked projects for a user. */
export const userProjectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(100),
});

export const userIdSchema = z.string().min(1, "شناسه کاربر الزامی است");

export type CreateStaffUserInput = z.input<typeof createUserSchema>;
export type UserProjectsInput = z.infer<typeof userProjectsSchema>;

