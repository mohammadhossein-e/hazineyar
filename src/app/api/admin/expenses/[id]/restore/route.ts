import { restoreExpense } from "@/core/expenses/service";
import { expenseIdSchema } from "@/core/expenses/schemas";
import { presentExpense } from "@/core/expenses/presenter";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/http";
import { notifyGroupOfCorrection } from "../../notify";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** POST /api/admin/expenses/:id/restore — bring a soft-deleted expense back. */
export async function POST(_request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError(
      "برای بازگردانی هزینه باید وارد شوید",
      "UNAUTHORIZED",
      401,
    );
  }

  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);

    const expense = await restoreExpense(expenseId, null);
    await notifyGroupOfCorrection(expense, "restore");

    return jsonOk({ expense: presentExpense(expense) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
