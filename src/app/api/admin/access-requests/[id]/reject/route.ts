import { presentAccessRequest } from "@/core/access/presenter";
import { rejectAccessRequest } from "@/core/access/service";
import { accessRequestIdSchema } from "@/core/access/schemas";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/access-requests/:id/reject
 *
 * Rejecting is sticky: the bot will not re-open a rejected request, so only an
 * admin can change the decision later.
 */
export async function POST(_request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError(
      "برای رد درخواست دسترسی باید وارد شوید",
      "UNAUTHORIZED",
      401,
    );
  }

  try {
    const { id } = await params;
    const requestId = accessRequestIdSchema.parse(id);
    const request = await rejectAccessRequest(requestId);

    return jsonOk({ request: presentAccessRequest(request) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
