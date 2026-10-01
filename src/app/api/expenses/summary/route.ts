import { getExpenseSummary } from "@/core/expenses/service";
import { summaryQuerySchema } from "@/core/expenses/schemas";
import { presentSummary } from "@/core/expenses/presenter";
import { jsonOk, queryToObject, toErrorResponse } from "@/lib/http";

/**
 * GET /api/expenses/summary?projectId=...   (projectId optional)
 * -> { today, thisWeek, thisMonth } totals in whole Toman, plus the exact
 *    period boundaries behind them. Without projectId the totals span every
 *    project and the response's projectId is null.
 *
 * `today` is the calendar day, `thisWeek` the Iranian week (Saturday–Friday)
 * and `thisMonth` the current Jalali month; both larger ranges are clamped to
 * the end of today. Next.js matches this static segment ahead of `[id]`.
 */
export async function GET(request: Request) {
  try {
    const { projectId } = summaryQuerySchema.parse(queryToObject(request.url));
    const summary = await getExpenseSummary(projectId);

    return jsonOk(presentSummary(summary));
  } catch (error) {
    return toErrorResponse(error);
  }
}
