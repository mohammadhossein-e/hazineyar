import { createProject, listAllProjects } from "@/core/projects/service";
import { presentProjects } from "@/core/projects/presenter";
import { createProjectSchema } from "@/core/projects/schemas";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Staff management for the dashboard owner. Telegram is the only channel, so
 * there is nothing to configure here.
 *
 * GET /api/admin/projects — every project, active or not, with expense counts
 * POST /api/admin/projects — { name }
 *
 * Both require the dashboard session, exactly like the Excel export: the admin
 * screen is data management behind the same single shared password.
 */
export async function GET() {
  if (!(await isSessionValid())) {
    return jsonError("برای مدیریت پروژه‌ها باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    return jsonOk({ projects: presentProjects(await listAllProjects()) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای ساخت پروژه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { name } = createProjectSchema.parse(await readJsonBody(request));
    const project = await createProject(name);

    return jsonOk({ project: presentProjects([project])[0] }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
