import { getExpenseHistory } from "@/core/expenses/service";
import { presentAuditLogs } from "@/core/expenses/presenter";
import { expenseIdSchema } from "@/core/expenses/schemas";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/admin/expenses/:id/history — the audit trail, newest first. */
export async function GET(_request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError(
      "برای مشاهده تاریخچه باید وارد شوید",
      "UNAUTHORIZED",
      401,
    );
  }

  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);

    const logs = await getExpenseHistory(expenseId);

    return jsonOk({ history: presentAuditLogs(logs) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
