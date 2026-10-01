import { attachInvoiceFile, getExpenseById } from "@/core/expenses/service";
import { expenseIdSchema } from "@/core/expenses/schemas";
import { presentExpense } from "@/core/expenses/presenter";
import { ValidationError } from "@/core/errors";
import { isSessionValid } from "@/lib/auth";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/http";
import {
  deleteInvoiceFile,
  saveInvoiceFile,
} from "@/lib/uploads";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/expenses/:id/invoice
 * multipart/form-data with a single `file` field (jpeg, png, webp or pdf,
 * max 5 MB). Stores the file under UPLOAD_DIR and links it to the expense.
 * Admin-session gate, like the rest of the write API.
 *
 * Disk hygiene: replace a previous invoice (if any) and, when attaching fails,
 * remove the file just written so UPLOAD_DIR cannot accumulate orphans.
 */
export async function POST(request: Request, { params }: Context) {
  if (!(await isSessionValid())) {
    return jsonError("برای بارگذاری فاکتور باید وارد شوید", "UNAUTHORIZED", 401);
  }

  let storedName: string | null = null;
  try {
    const { id } = await params;
    const expenseId = expenseIdSchema.parse(id);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(
        "بدنه درخواست باید multipart/form-data باشد",
        "INVALID_MULTIPART",
        400,
      );
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new ValidationError("فایل با نام «file» ارسال نشده است");
    }

    const expense = await getExpenseById(expenseId);
    const previous = expense.invoiceFilePath;

    storedName = await saveInvoiceFile({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      invoiceNumber: expense.invoiceNumber,
    });

    const updated = await attachInvoiceFile(expenseId, storedName);

    // Replacing an invoice: drop the old file now that the new link is stored.
    if (previous && previous !== storedName) {
      await deleteInvoiceFile(previous).catch(() => undefined);
    }

    return jsonOk(presentExpense(updated));
  } catch (error) {
    // The write failed after the bytes hit disk; take the file back.
    if (storedName) {
      await deleteInvoiceFile(storedName).catch(() => undefined);
    }
    return toErrorResponse(error);
  }
}