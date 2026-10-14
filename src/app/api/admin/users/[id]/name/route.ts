import { presentUser } from "@/core/users/presenter";
import { userIdSchema, userNameInputSchema } from "@/core/users/schemas";
import { duplicateNameWarning, renameUser } from "@/core/users/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/:id/name — { name }
 *
 * Renames a user with the same rules as creating one. Expenses point at the
 * user id, so the new name shows up everywhere at once (dashboard, Excel
 * export, later bot messages); nothing historical is rewritten. A clash with
 * another active user's name is only a soft `warning`.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای ویرایش نام کاربر باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const userId = userIdSchema.parse(id);
    const { name } = userNameInputSchema.parse(await readJsonBody(request));

    const warning = await duplicateNameWarning(name, userId);
    const user = await renameUser(userId, name);

    return jsonOk({
      user: presentUser(user),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
