import {
  editExpense,
  softDeleteExpense,
} from "@/core/expenses/service";
import {
  adminDeleteExpenseSchema,
  editExpenseSchema,
  expenseIdSchema,
} from "@/core/expenses/schemas";
import { presentExpense } from "@/core/expenses/presenter";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, readJsonBody, toErrorResponse } from "@/lib/http";
import { notifyGroupOfCorrection } from "../notify";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/expenses/:id — edit an expense from the dashboard.
 *
 * Body: any of projectId/userId/category/amount/description/expenseDate, plus
 * `expectedUpdatedAt` for optimistic concurrency. A stale token is refused with
 * 409 so two admins cannot silently overwrite each other.
 */
export async function PATCH(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای ویرایش هزینه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);
    const input = editExpenseSchema.parse(await readJsonBody(request));

    const expense = await editExpense(expenseId, null, input);
    await notifyGroupOfCorrection(expense, "edit");

    return jsonOk({ expense: presentExpense(expense, { isEdited: true }) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/admin/expenses/:id — soft delete (ADMIN session).
 *
 * Body: optional `reason` and `expectedUpdatedAt`.
 */
export async function DELETE(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای حذف هزینه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);
    const input = adminDeleteExpenseSchema.parse(await readJsonBody(request));

    const expense = await softDeleteExpense(expenseId, null, input);
    await notifyGroupOfCorrection(expense, "delete", input.reason ?? null);

    return jsonOk({ expense: presentExpense(expense) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
