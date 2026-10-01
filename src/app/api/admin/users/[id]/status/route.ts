import { presentUser } from "@/core/users/presenter";
import { userIdSchema, userStatusSchema } from "@/core/users/schemas";
import { setUserActive } from "@/core/users/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/:id/status — { isActive }
 *
 * Deactivating is not a delete: past expenses keep their recorder, and the bot
 * refuses the account from then on. Reactivating restores the same row and the
 * same project links.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای تغییر وضعیت کاربر باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const userId = userIdSchema.parse(id);
    const { isActive } = userStatusSchema.parse(await readJsonBody(request));
    const user = await setUserActive(userId, isActive);

    return jsonOk({ user: presentUser(user) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
