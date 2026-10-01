import { presentProject } from "@/core/projects/presenter";
import { projectStatusSchema } from "@/core/projects/schemas";
import { setProjectActive } from "@/core/projects/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/projects/:id/status — { isActive }
 *
 * Deactivating is not a delete: the project's expenses, invoice numbers and
 * reports stay intact and it only disappears from the bot's project picker and
 * the dashboard's default filters.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای تغییر وضعیت پروژه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const { isActive } = projectStatusSchema.parse(await readJsonBody(request));
    const project = await setProjectActive(id, isActive);

    return jsonOk({ project: presentProject(project) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
