import {
  createExpense,
  listExpenses,
} from "@/core/expenses/service";
import {
  createExpenseSchema,
  parseExpenseListQuery,
} from "@/core/expenses/schemas";
import { presentExpense, presentExpenses } from "@/core/expenses/presenter";
import { isSessionValid } from "@/lib/auth";
import {
  jsonError,
  jsonOk,
  queryToObject,
  readJsonBody,
  toErrorResponse,
} from "@/lib/http";

/**
 * GET /api/expenses
 * Query: projectId, userId, category (key or Persian label), dateFrom, dateTo,
 *        page (default 1), pageSize (default 20, max 100)
 */
export async function GET(request: Request) {
  try {
    const serviceQuery = parseExpenseListQuery(queryToObject(request.url));
    const result = await listExpenses(serviceQuery);

    return jsonOk({
      items: presentExpenses(result.items),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/expenses
 * Body: projectId, userId, category, amount (whole Toman), expenseDate,
 *       description?, invoiceFilePath?
 * No auth yet: userId is taken from the body and later resolved from the channel.
 */
export async function POST(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای ثبت هزینه باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const input = createExpenseSchema.parse(await readJsonBody(request));
    const expense = await createExpense(input);

    return jsonOk(presentExpense(expense), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
