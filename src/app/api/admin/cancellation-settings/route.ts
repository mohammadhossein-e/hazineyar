import { cancellationSettingsSchema } from "@/core/settings/schemas";
import {
  getCancellationSettings,
  updateCancellationSettings,
} from "@/core/settings/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/cancellation-settings — the self-cancel window
 * POST /api/admin/cancellation-settings — { windowMinutes }
 *
 * `windowMinutes: 0` disables self-cancellation and hides the button. The value
 * is read fresh by the bot, so a change applies without a restart.
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
    return jsonOk({ settings: await getCancellationSettings() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای ذخیره تنظیمات باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const input = cancellationSettingsSchema.parse(await readJsonBody(request));
    const settings = await updateCancellationSettings(input);

    return jsonOk({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}
