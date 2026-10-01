import {
  getExpenseById,
  softDeleteExpense,
} from "@/core/expenses/service";
import {
  expenseIdSchema,
  requestingUserSchema,
} from "@/core/expenses/schemas";
import { presentExpense } from "@/core/expenses/presenter";
import { isSessionValid } from "@/lib/auth";
import {
  jsonError,
  jsonOk,
  queryToObject,
  readJsonBody,
  toErrorResponse,
} from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

/** GET /api/expenses/:id */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const expense = await getExpenseById(expenseIdSchema.parse(id));

    return jsonOk(presentExpense(expense));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/expenses/:id  (soft delete, ADMIN only)
 * Session-gated like the other write endpoints; `requestingUserId` may arrive
 * in the query string or the JSON body, since a DELETE body is awkward for
 * some clients.
 */
export async function DELETE(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای حذف هزینه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);

    const { requestingUserId } = requestingUserSchema.parse({
      ...queryToObject(request.url),
      ...((await readJsonBody(request)) as Record<string, unknown>),
    });

    const expense = await softDeleteExpense(expenseId, requestingUserId);

    return jsonOk(presentExpense(expense));
  } catch (error) {
    return toErrorResponse(error);
  }
}
