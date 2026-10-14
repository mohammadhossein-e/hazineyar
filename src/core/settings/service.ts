import { prisma } from "@/lib/db";
import {
  announcementSettingsSchema,
  cancellationSettingsSchema,
  DEFAULT_ANNOUNCEMENT_SETTINGS,
  DEFAULT_CANCELLATION_SETTINGS,
  type AnnouncementSettings,
  type CancellationSettings,
} from "./schemas";

/** A stable key for the single JSON settings row. */
const ANNOUNCEMENT_KEY = "announcement";
const CANCELLATION_KEY = "cancellation";

/**
 * Reads the announcement settings, falling back to the defaults when the row
 * is missing or was edited into an invalid shape. The bot calls this right
 * before announcing, so the dashboard's latest change is always used.
 */
export async function getAnnouncementSettings(): Promise<AnnouncementSettings> {
  const row = await prisma.setting.findUnique({
    where: { key: ANNOUNCEMENT_KEY },
  });
  if (!row) return DEFAULT_ANNOUNCEMENT_SETTINGS;

  try {
    const parsed = announcementSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_ANNOUNCEMENT_SETTINGS;
  } catch {
    return DEFAULT_ANNOUNCEMENT_SETTINGS;
  }
}

export async function updateAnnouncementSettings(
  input: AnnouncementSettings,
): Promise<AnnouncementSettings> {
  const settings = announcementSettingsSchema.parse(input);
  const value = JSON.stringify(settings);
  await prisma.setting.upsert({
    where: { key: ANNOUNCEMENT_KEY },
    create: { key: ANNOUNCEMENT_KEY, value },
    update: { value },
  });
  return settings;
}

/**
 * Reads the self-cancellation window, falling back to the default when the row
 * is missing or was edited into an invalid shape. The bot reads this right
 * before cancel is offered, so a dashboard change applies without a restart.
 */
export async function getCancellationSettings(): Promise<CancellationSettings> {
  const row = await prisma.setting.findUnique({
    where: { key: CANCELLATION_KEY },
  });
  if (!row) return DEFAULT_CANCELLATION_SETTINGS;

  try {
    const parsed = cancellationSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_CANCELLATION_SETTINGS;
  } catch {
    return DEFAULT_CANCELLATION_SETTINGS;
  }
}

export async function updateCancellationSettings(
  input: CancellationSettings,
): Promise<CancellationSettings> {
  const settings = cancellationSettingsSchema.parse(input);
  const value = JSON.stringify(settings);
  await prisma.setting.upsert({
    where: { key: CANCELLATION_KEY },
    create: { key: CANCELLATION_KEY, value },
    update: { value },
  });
  return settings;
}
