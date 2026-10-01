import { z } from "zod";

/**
 * Project names are free text (Persian, digits, spaces), so the only rules are
 * length and non-emptiness. Uniqueness is enforced in the service, because it
 * depends on the other rows.
 */
export const MAX_PROJECT_NAME_LENGTH = 80;

export const projectNameSchema = z
  .string()
  .trim()
  .min(2, "نام پروژه باید حداقل ۲ کاراکتر باشد")
  .max(MAX_PROJECT_NAME_LENGTH, `نام پروژه باید حداکثر ${MAX_PROJECT_NAME_LENGTH} کاراکتر باشد`);

export const createProjectSchema = z.object({ name: projectNameSchema });

export const projectStatusSchema = z.object({
  isActive: z.boolean("وضعیت پروژه باید فعال یا غیرفعال باشد"),
});
