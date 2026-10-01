import { z } from "zod";
import { Role } from "@prisma/client";

export const MAX_USER_NAME_LENGTH = 80;

/** A Telegram user id is a positive integer, and the bot matches on it exactly. */
export const externalIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, "شناسه تلگرام باید فقط عدد باشد");

export const roleSchema = z.enum(Role, {
  error: () => ({ message: "نقش کاربر نامعتبر است" }),
});

export const userNameSchema = z
  .string()
  .trim()
  .min(2, "نام باید حداقل ۲ کاراکتر باشد")
  .max(MAX_USER_NAME_LENGTH, `نام باید حداکثر ${MAX_USER_NAME_LENGTH} کاراکتر باشد`);

export const createUserSchema = z.object({
  name: userNameSchema,
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

