import {
  announcementSettingsSchema,
} from "@/core/settings/schemas";
import {
  getAnnouncementSettings,
  updateAnnouncementSettings,
} from "@/core/settings/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/settings — the group announcement settings
 * POST /api/admin/settings — { announceMode, includeInvoice, announceDirectExpenses }
 *
 * The value is stored as one row and read fresh by the bot at announcement
 * time, so saving here changes behaviour without a restart.
 */
export async function GET() {
  if (!(await isSessionValid())) {
    return jsonError(
      "برای مشاهده تنظیمات باید وارد شوید",
      "UNAUTHORIZED",
      401,
    );
  }

  try {
    return jsonOk({ settings: await getAnnouncementSettings() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای ذخیره تنظیمات باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const input = announcementSettingsSchema.parse(await readJsonBody(request));
    const settings = await updateAnnouncementSettings(input);

    return jsonOk({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}
