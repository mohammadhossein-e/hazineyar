import { prisma } from "@/lib/db";
import {
  Prisma,
  type ExpenseCategory,
} from "@prisma/client";
import {
  clampToToday,
  getDayRange,
  getIranWeekRange,
  getJalaliMonthRange,
  type DateRange,
} from "@/lib/jalali";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { getProject } from "../projects/service";
import { getUserById } from "../users/service";
import {
  createExpenseSchema,
  type CreateExpenseInput,
  type ListExpensesQuery,
} from "./schemas";

export const EXPENSE_INCLUDE = {
  project: true,
  user: true,
} satisfies Prisma.ExpenseInclude;

type Tx = Prisma.TransactionClient;

/**
 * Invoice numbers are sequential **per project**: the first expense of a
 * project is `invoice_001`, its second `invoice_002`, and another project
 * restarts from `invoice_001`. Invoice numbers stay unique within a project,
 * which is what the crew reads off a paper invoice.
 *
 * Soft-deleted rows are counted too, so a number is never reissued.
 */
async function nextInvoiceNumber(projectId: string, tx: Tx): Promise<string> {
  const used = await tx.expense.count({ where: { projectId } });
  return `invoice_${String(used + 1).padStart(3, "0")}`;
}

/** Concurrent duplicates are resolved by re-counting, up to this many tries. */
const INVOICE_NUMBER_RETRIES = 3;

function buildWhere(filters: {
  projectId?: string;
  userId?: string;
  category?: ExpenseCategory;
  from?: Date;
  to?: Date;
}): Prisma.ExpenseWhereInput {
  return {
    deletedAt: null,
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.from || filters.to
      ? {
          expenseDate: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };
}

/** Admins may record on any active project; employees only where linked. */
async function assertCanRecordFor(userId: string, projectId: string): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new NotFoundError("کاربر یافت نشد");
  if (!user.isActive) throw new ForbiddenError("کاربر غیرفعال است");

  const project = await getProject(projectId);
  if (!project.isActive) throw new ForbiddenError("پروژه غیرفعال است");

  if (user.role === "ADMIN") return;

  const allowed = await prisma.userProject.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });
  if (!allowed) {
    throw new ForbiddenError("شما مجاز به ثبت هزینه برای این پروژه نیستید");
  }
}

/**
 * Records an expense. Numbering is count-and-insert inside one transaction, and
 * the `(projectId, invoiceNumber)` unique index turns a parallel submission
 * from a silent duplicate into a retriable collision: the loser re-counts and
 * takes the next free number instead of reusing the winner's.
 */
export async function createExpense(input: CreateExpenseInput) {
  const data = createExpenseSchema.parse(input);
  await assertCanRecordFor(data.userId, data.projectId);

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const invoiceNumber = await nextInvoiceNumber(data.projectId, tx);

        return tx.expense.create({
          data: {
            projectId: data.projectId,
            userId: data.userId,
            category: data.category,
            amount: BigInt(data.amount),
            description: data.description,
            invoiceFilePath: data.invoiceFilePath,
            expenseDate: data.expenseDate,
            invoiceNumber,
          },
          include: EXPENSE_INCLUDE,
        });
      });
    } catch (error) {
      const collision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      // Anything but an invoice-number collision is a real failure.
      if (!collision) throw error;
      if (attempt >= INVOICE_NUMBER_RETRIES) {
        throw new ValidationError(
          "ثبت هزینه پر ازدحام شد؛ لطفاً دوباره تلاش کنید",
        );
      }
    }
  }
}

export type ExpenseListResult = {
  items: Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Paginated listing; soft-deleted rows are always excluded. */
export async function listExpenses(
  filters: Partial<ListExpensesQuery> = {},
): Promise<ExpenseListResult> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const where = buildWhere(filters);

  const [items, total] = await prisma.$transaction([
    prisma.expense.findMany({
      where,
      include: EXPENSE_INCLUDE,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.expense.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

export async function getExpenseById(id: string) {
  const expense = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
    include: EXPENSE_INCLUDE,
  });
  if (!expense) throw new NotFoundError("هزینه یافت نشد");
  return expense;
}

/** Backwards-compatible alias kept for existing callers. */
export const getExpense = getExpenseById;

/** Sanity cap for the Excel export: never pile a runaway workbook into memory. */
export const EXPORT_ROW_CAP = 10_000;

export type ExpenseExportFilters = {
  projectId?: string;
  userId?: string;
  category?: ExpenseCategory;
  from?: Date;
  to?: Date;
};

/**
 * Every row matching the filters, in the same order and with the same
 * soft-delete rule as the paginated list, but without pagination so a report
 * can be handed over whole. Reuses `buildWhere`, so the filtering never drifts
 * from `listExpenses`. Counts first and fails loudly once the cap is reached,
 * instead of selecting tens of thousands of rows into memory.
 */
export async function listExpensesForExport(
  filters: ExpenseExportFilters = {},
): Promise<Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>[]> {
  const where = buildWhere(filters);
  const total = await prisma.expense.count({ where });
  if (total > EXPORT_ROW_CAP) {
    throw new ValidationError(
      `نتیجه بیش از ${EXPORT_ROW_CAP} ردیف است؛ بازه یا فیلترها را محدودتر انتخاب کنید`,
    );
  }
  return prisma.expense.findMany({
    where,
    include: EXPENSE_INCLUDE,
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
  });
}

/** Attaches an already-stored invoice file to an expense. */
export async function attachInvoiceFile(id: string, storedPath: string) {
  const expense = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!expense) throw new NotFoundError("هزینه یافت نشد");

  return prisma.expense.update({
    where: { id },
    data: { invoiceFilePath: storedPath },
    include: EXPENSE_INCLUDE,
  });
}

async function sumInRange(where: Prisma.ExpenseWhereInput) {
  const result = await prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true });
  return { total: result._sum.amount ?? 0n, count: result._count };
}

export type ExpensePeriodKey = "today" | "thisWeek" | "thisMonth";

export type ExpenseSummary = Record<
  ExpensePeriodKey,
  { total: bigint; count: number }
> & {
  /** null when the summary was aggregated across every project. */
  projectId: string | null;
  ranges: Record<ExpensePeriodKey, DateRange>;
};

/**
 * Totals for today, the Iranian week (Saturday–Friday) and the current Jalali
 * month. Week and month are clamped to the end of today, so each range reads
 * "spent so far" and today is always a subset of the larger ranges.
 *
 * With a `projectId` the project is validated first and only its rows count.
 * With no `projectId` the same ranges are summed across everything (still
 * excluding soft-deleted rows), which backs the dashboard's "همه پروژه‌ها".
 */
export async function getExpenseSummary(projectId?: string): Promise<ExpenseSummary> {
  const project = projectId ? await getProject(projectId) : null;
  const now = new Date();

  const ranges: Record<ExpensePeriodKey, DateRange> = {
    today: getDayRange(now),
    thisWeek: clampToToday(getIranWeekRange(now), now),
    thisMonth: clampToToday(getJalaliMonthRange(now), now),
  };

  const [today, thisWeek, thisMonth] = await Promise.all(
    (Object.keys(ranges) as ExpensePeriodKey[]).map((key) =>
      sumInRange({
        deletedAt: null,
        ...(project ? { projectId: project.id } : {}),
        expenseDate: { gte: ranges[key].from, lte: ranges[key].to },
      }),
    ),
  );

  return { projectId: project?.id ?? null, today, thisWeek, thisMonth, ranges };
}

/** Soft delete: the row is kept for auditing and hidden from all listings. */
export async function softDeleteExpense(id: string, requestingUserId: string) {
  const requester = await getUserById(requestingUserId);
  if (!requester) throw new NotFoundError("کاربر درخواست‌دهنده یافت نشد");
  if (requester.role !== "ADMIN") {
    throw new ForbiddenError("فقط مدیر می‌تواند هزینه را حذف کند");
  }

  const expense = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!expense) throw new NotFoundError("هزینه یافت نشد");

  return prisma.expense.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: EXPENSE_INCLUDE,
  });
}
