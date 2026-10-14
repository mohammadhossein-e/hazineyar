import { z } from "zod";

export const ANNOUNCE_MODES = ["FULL", "MINIMAL", "OFF"] as const;

export type AnnounceMode = (typeof ANNOUNCE_MODES)[number];

export const announceModeSchema = z.enum(ANNOUNCE_MODES, {
  error: () => ({ message: "حالت اعلام نامعتبر است" }),
});

/**
 * The group announcement settings. They are stored as one JSON row and read
 * fresh at announcement time, so a change on the dashboard takes effect
 * without restarting the bot.
 */
export const announcementSettingsSchema = z.object({
  announceMode: announceModeSchema,
  includeInvoice: z.boolean("وضعیت پیوست فاکتور باید بله یا خیر باشد"),
  /**
   * Whether an expense recorded by starting the bot directly in a private chat
   * (no group deep link) is announced to every linked group. Defaults to true
   * so a row saved before this setting existed keeps announcing.
   */
  announceDirectExpenses: z
    .boolean("وضعیت اعلام هزینه‌های مستقیم باید بله یا خیر باشد")
    .default(true),
});

export type AnnouncementSettings = z.infer<typeof announcementSettingsSchema>;

export const DEFAULT_ANNOUNCEMENT_SETTINGS: AnnouncementSettings = {
  announceMode: "FULL",
  includeInvoice: true,
  announceDirectExpenses: true,
};

/**
 * How long after recording an expense the employee may still cancel it from the
 * bot. A window of 0 disables self-cancellation entirely.
 */
export const MAX_CANCELLATION_WINDOW_MINUTES = 24 * 60;

export const cancellationSettingsSchema = z.object({
  windowMinutes: z.coerce
    .number("مدت زمان باید عدد باشد")
    .int("مدت زمان باید عدد صحیح باشد")
    .min(0, "مدت زمان نمی‌تواند منفی باشد")
    .max(
      MAX_CANCELLATION_WINDOW_MINUTES,
      "مدت زمان حداکثر ۲۴ ساعت (۱۴۴۰ دقیقه) است",
    ),
});

export type CancellationSettings = z.infer<typeof cancellationSettingsSchema>;

export const DEFAULT_CANCELLATION_SETTINGS: CancellationSettings = {
  windowMinutes: 15,
};
