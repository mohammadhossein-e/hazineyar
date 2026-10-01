import { presentUser, presentUsers } from "@/core/users/presenter";
import { createUserSchema } from "@/core/users/schemas";
import { createStaffUser, listAllUsers } from "@/core/users/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Staff accounts for the dashboard owner.
 *
 * GET /api/admin/users — every user, active or not, with their project access
 * POST /api/admin/users — { name, externalId, role, projectIds }
 *
 * `externalId` is the employee's numeric Telegram id, the value the bot
 * resolves a user by. Both endpoints require the dashboard session.
 */
export async function GET() {
  if (!(await isSessionValid())) {
    return jsonError("برای مدیریت کاربران باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    return jsonOk({ users: presentUsers(await listAllUsers()) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای ساخت کاربر باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const input = createUserSchema.parse(await readJsonBody(request));
    const user = await createStaffUser(input);

    return jsonOk({ user: presentUser(user) }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
