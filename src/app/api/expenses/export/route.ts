import ExcelJS from "exceljs";
import { parseExpenseListQuery } from "@/core/expenses/schemas";
import { presentExpenses } from "@/core/expenses/presenter";
import {
  listExpensesForExport,
} from "@/core/expenses/service";
import { isSessionValid } from "@/lib/auth";
import { jsonError, queryToObject, toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Mirrors the dashboard columns, in the same visual order. */
const EXPORT_HEADERS = ["تاریخ", "پروژه", "ثبت‌کننده", "نوع هزینه", "مبلغ", "فاکتور"] as const;
const EXPORT_WIDTHS = [14, 18, 18, 16, 14, 18];

/** Excel sheet names reject []:*?/\ and are limited to 31 characters. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*/?\\]/g, "").trim().slice(0, 31);
  return cleaned || "هزینه‌ها";
}

/** ASCII-only, so it survives any Content-Disposition parse and file system. */
function buildFileName(params: Record<string, string>): string {
  const project = params.projectId ?? "all";
  const range = [params.dateFrom, params.dateTo].filter(Boolean).join("-to-");
  return `hazineyar-${project}${range ? `-${range}` : ""}-${Date.now()}.xlsx`.replace(
    /[^A-Za-z0-9._-]/g,
    "-",
  );
}

async function buildWorkbook(
  rows: ReturnType<typeof presentExpenses>,
  sheetName: string,
): Promise<Awaited<ReturnType<ExcelJS.Workbook["xlsx"]["writeBuffer"]>>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hazineyar";
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
  });

  const header = sheet.addRow([...EXPORT_HEADERS]);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF1F2937" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle" };
  });

  sheet.columns.forEach((column, index) => {
    column.width = EXPORT_WIDTHS[index] ?? 14;
  });

  for (const row of rows) {
    const line = sheet.addRow([
      row.expenseDateJalali,
      row.projectName ?? "",
      row.userName ?? "",
      row.categoryLabel,
      row.amount,
      row.invoiceNumber,
    ]);
    line.getCell(5).numFmt = "#,##0";
  }

  return workbook.xlsx.writeBuffer();
}

/**
 * GET /api/expenses/export
 * Query: projectId, userId, category (key or Persian label), dateFrom, dateTo
 *
 * Admin-only: the dashboard's session cookie is required, otherwise 401. Unlike
 * GET /api/expenses this is not gated by the proxy, so the cookie is compared
 * against ADMIN_PASSWORD here rather than just looked for.
 */
export async function GET(request: Request) {
  if (!(await isSessionValid())) {
    return jsonError("برای دانلود فایل باید وارد شوید", "UNAUTHORIZED", 401);
  }

  try {
    const params = queryToObject(request.url);
    const filters = parseExpenseListQuery(params);
    const rows = presentExpenses(
      await listExpensesForExport({
        projectId: filters.projectId,
        userId: filters.userId,
        category: filters.category,
        from: filters.from,
        to: filters.to,
      }),
    );

    const sheetName = safeSheetName(
      filters.projectId
        ? rows[0]?.projectName ?? "هزینه‌ها"
        : "همه پروژه‌ها",
    );
    const buffer = await buildWorkbook(rows, sheetName);
    const fileName = buildFileName(params);

    return new Response(buffer, {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}