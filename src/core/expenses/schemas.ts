import { z } from "zod";
import { ExpenseCategory } from "@prisma/client";
import { categoryLabel, parseCategory } from "./categories";

/** Amounts are whole Toman; no decimals. */
export const amountSchema = z
  .number()
  .int("مبلغ باید عدد صحیح باشد")
  .positive("مبلغ باید بزرگ‌تر از صفر باشد");

export const categorySchema = z.enum(ExpenseCategory, {
  error: () => ({
    message: `دسته‌بندی نامعتبر است. دسته‌های مجاز: ${Object.values(ExpenseCategory)
      .map(categoryLabel)
      .join("، ")}`,
  }),
});

/** Long enough for a note, short enough to stay a line in the expense list. */
export const MAX_DESCRIPTION_LENGTH = 500;

export const createExpenseSchema = z.object({
  projectId: z.string().min(1, "شناسه پروژه الزامی است"),
  userId: z.string().min(1, "شناسه کاربر الزامی است"),
  category: categorySchema,
  amount: amountSchema,
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
  invoiceFilePath: z.string().trim().max(500).optional(),
  expenseDate: z.coerce.date(),
});

export const expenseIdSchema = z.string().min(1, "شناسه هزینه الزامی است");

/**
 * Query-string category: accepts the English key or the Persian label so the
 * dashboard and the Telegram bot can pass whatever the user typed.
 */
const categoryQuerySchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    const parsed = parseCategory(value);
    if (!parsed) {
      ctx.addIssue({
        code: "custom",
        message: `دسته‌بندی نامعتبر است. دسته‌های مجاز: ${Object.values(
          ExpenseCategory,
        )
          .map(categoryLabel)
          .join("، ")}`,
      });
      return z.NEVER;
    }
    return parsed;
  });

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const listExpensesQuerySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    category: categoryQuerySchema,
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    page: z.coerce.number().int("شماره صفحه باید عدد صحیح باشد").min(1).default(1),
    pageSize: z.coerce
      .number()
      .int("تعداد در هر صفحه باید عدد صحیح باشد")
      .min(1)
      .max(MAX_PAGE_SIZE, `تعداد در هر صفحه حداکثر ${MAX_PAGE_SIZE} است`)
      .default(DEFAULT_PAGE_SIZE),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
    message: "dateFrom نباید بعد از dateTo باشد",
    path: ["dateFrom"],
  });

export const summaryQuerySchema = z.object({
  /** Omit for totals across every project; present values must be non-empty. */
  projectId: z.string().min(1, "شناسه پروژه نامعتبر است").optional(),
});

/** No auth yet: the caller states who is asking. DELETE accepts body or query. */
export const requestingUserSchema = z.object({
  requestingUserId: z.string().min(1, "شناسه کاربر درخواست‌دهنده الزامی است"),
});

/** The service-facing filter shape: validated, with dates renamed to from/to. */
export type ExpenseListServiceQuery = {
  projectId?: string;
  userId?: string;
  category?: ExpenseCategory;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a raw query string against `listExpensesQuerySchema` and maps it to
 * the service's `from`/`to` shape. A bare `YYYY-MM-DD` `dateTo` — what an
 * `<input type="date">` sends — is expanded to the end of UTC day so a
 * same-day expense is not missed. The list and Excel-export endpoints share
 * this so their results never drift apart.
 */
export function parseExpenseListQuery(raw: Record<string, string>): ExpenseListServiceQuery {
  const parsed = listExpensesQuerySchema.parse(raw);
  let to = parsed.dateTo;
  if (parsed.dateTo && typeof raw.dateTo === "string" && BARE_DATE.test(raw.dateTo)) {
    to = new Date(parsed.dateTo);
    to.setUTCHours(23, 59, 59, 999);
  }
  return {
    projectId: parsed.projectId,
    userId: parsed.userId,
    category: parsed.category,
    from: parsed.dateFrom,
    to,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/** Optional free-text reason attached to a delete/cancel, shown in the audit. */
export const auditReasonSchema = z
  .string()
  .trim()
  .max(MAX_DESCRIPTION_LENGTH)
  .optional();

/**
 * The `updatedAt` the caller last saw, as an ISO string. Used for optimistic
 * concurrency: a stale value means someone else changed the row first.
 */
const expectedUpdatedAtSchema = z.coerce.date().optional();

/**
 * Editable fields. Every field is optional so the dashboard can PATCH a single
 * column; the service validates at least one real change. `expectedUpdatedAt`
 * is the optimistic-concurrency token.
 */
export const editExpenseSchema = z
  .object({
    projectId: z.string().min(1, "شناسه پروژه الزامی است").optional(),
    userId: z.string().min(1, "شناسه کاربر الزامی است").optional(),
    category: categorySchema.optional(),
    amount: amountSchema.optional(),
    description: z
      .string()
      .trim()
      .max(MAX_DESCRIPTION_LENGTH)
      .nullable()
      .optional(),
    expenseDate: z.coerce.date().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine(
    (value) =>
      value.projectId !== undefined ||
      value.userId !== undefined ||
      value.category !== undefined ||
      value.amount !== undefined ||
      value.description !== undefined ||
      value.expenseDate !== undefined,
    { message: "هیچ تغییری برای ذخیره ارسال نشده است" },
  );

export type EditExpenseInput = z.infer<typeof editExpenseSchema>;

/** DELETE / cancel: the requesting admin plus an optional reason and token. */
export const deleteExpenseSchema = z.object({
  requestingUserId: z.string().min(1, "شناسه کاربر درخواست‌دهنده الزامی است"),
  reason: auditReasonSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
});

export type DeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;

/**
 * The dashboard is behind the owner's session and has no per-person identity,
 * so its correction routes carry only the optional reason and concurrency
 * token; the audit records `actorType = ADMIN_DASHBOARD` with no user id.
 */
export const adminDeleteExpenseSchema = z.object({
  reason: auditReasonSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
});

export const adminRestoreExpenseSchema = z.object({});

export const restoreExpenseSchema = z.object({
  requestingUserId: z.string().min(1, "شناسه کاربر درخواست‌دهنده الزامی است"),
});

export type RestoreExpenseInput = z.infer<typeof restoreExpenseSchema>;

/** Same filters as the list, plus the deleted-only view for the dashboard. */
export const deletedExpensesQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
