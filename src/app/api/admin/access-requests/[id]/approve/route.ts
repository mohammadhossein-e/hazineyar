import { approveAccessRequest } from "@/core/access/service";
import {
  accessRequestIdSchema,
  approveAccessRequestSchema,
} from "@/core/access/schemas";
import { presentUser } from "@/core/users/presenter";
import { createTelegramNotifier } from "@/adapters/telegram/notifier";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/access-requests/:id/approve — { name?, role, projectIds }
 *
 * Creates the staff account with the exact validation the manual form uses and
 * marks the request APPROVED. The user is then notified in their private chat
 * through a separate HTTPS call; if that fails (the user blocked the bot), the
 * approval still stands and a soft `warning` is returned for the dashboard.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError(
      "برای تایید درخواست دسترسی باید وارد شوید",
      "UNAUTHORIZED",
      401,
    );
  }

  try {
    const { id } = await params;
    const requestId = accessRequestIdSchema.parse(id);
    const input = approveAccessRequestSchema.parse(await readJsonBody(request));

    const result = await approveAccessRequest(
      { id: requestId, ...input },
      createTelegramNotifier(),
    );

    const warnings: string[] = [];
    if (result.warning) warnings.push(result.warning);
    if (!result.notified) {
      warnings.push(
        "کاربر ساخته شد، اما پیام اطلاع‌رسانی در تلگرام ارسال نشد (شاید کاربر ربات را بلاک کرده باشد).",
      );
    }

    return jsonOk({
      user: presentUser(result.user),
      notified: result.notified,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
