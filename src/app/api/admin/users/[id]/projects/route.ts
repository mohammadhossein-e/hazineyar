import { presentUser } from "@/core/users/presenter";
import { userIdSchema, userProjectsSchema } from "@/core/users/schemas";
import { setUserProjects } from "@/core/users/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/:id/projects — { projectIds }
 *
 * The whole set is replaced in one transaction, so the list is the list the
 * owner ticked. Dropping a project revokes that project's access without
 * touching the others, and an empty array revokes all of them while leaving the
 * account active.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای ویرایش دسترسی‌ها باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const userId = userIdSchema.parse(id);
    const { projectIds } = userProjectsSchema.parse(await readJsonBody(request));
    const user = await setUserProjects(userId, { projectIds });

    return jsonOk({ user: presentUser(user) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
