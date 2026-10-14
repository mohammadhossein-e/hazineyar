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
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from "../errors";
import { getProject } from "../projects/service";
import { getUserById } from "../users/service";
import { getCancellationSettings } from "../settings/service";
import { listAuditLogs, snapshotExpense, writeAuditLog } from "./audit";
import type { AnnouncedChat } from "./announcement";
import {
  createExpenseSchema,
  editExpenseSchema,
  type CreateExpenseInput,
  type EditExpenseInput,
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
 * The next number comes from the project's `ProjectInvoiceCounter`, not from
 * the row count: the count drifts below the real maximum as soon as a number is
 * skipped, and `count + 1` then collides forever on the `(projectId,
 * invoiceNumber)` unique index. The counter is seeded from the highest suffix
 * already in use — well-formed `invoice_<digits>` only, soft-deleted rows
 * included — when the row is missing, and advanced with a single atomic upsert
 * otherwise. Because the update locks the counter row until the surrounding
 * transaction commits, two concurrent creates serialize and cannot share a
 * number.
 */
async function nextInvoiceNumber(projectId: string, tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "ProjectInvoiceCounter" ("projectId", "lastNumber", "updatedAt")
    SELECT ${projectId},
           COALESCE(
             MAX(
               CASE
                 WHEN "invoiceNumber" ~ '^invoice_[0-9]{1,9}$'
                 THEN (SUBSTRING("invoiceNumber" FROM 'invoice_([0-9]{1,9})'))::integer
                 ELSE 0
               END
             ),
             0
           ) + 1,
           NOW()
    FROM "Expense"
    WHERE "projectId" = ${projectId}
    ON CONFLICT ("projectId") DO UPDATE
    SET "lastNumber" = GREATEST(
          "ProjectInvoiceCounter"."lastNumber",
          EXCLUDED."lastNumber" - 1
        ) + 1,
        "updatedAt" = NOW()
    RETURNING "lastNumber";
  `;

  const next = rows[0]?.lastNumber ?? 1;
  return `invoice_${String(next).padStart(3, "0")}`;
}

/** Concurrent duplicates are resolved by re-reading fresh state, up to this many tries. */
const INVOICE_NUMBER_RETRIES = 3;

/**
 * Whether a P2002 is the `(projectId, invoiceNumber)` collision the retry loop
 * exists to absorb, rather than some other unique violation that should surface
 * immediately. `meta.target` is not always populated, so an absent target is
 * treated as a retryable invoice collision (the only unique pair on Expense).
 */
function isInvoiceNumberCollision(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes("invoiceNumber");
  if (typeof target === "string") return target.includes("invoiceNumber");
  return true;
}

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
 * Records an expense. The invoice number is allocated from the project's
 * counter inside the same transaction as the insert, so concurrent callers are
 * serialized on the counter row. The `(projectId, invoiceNumber)` unique index
 * is kept only as a last-resort safety net: if a collision somehow still
 * happens, each retry starts a fresh transaction and therefore allocates a
 * *new* number from the counter, so it can never loop on the same value.
 */
export async function createExpense(input: CreateExpenseInput) {
  const data = createExpenseSchema.parse(input);
  await assertCanRecordFor(data.userId, data.projectId);

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const invoiceNumber = await nextInvoiceNumber(data.projectId, tx);

        const expense = await tx.expense.create({
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

        // Remember the choice so the bot can offer a one-tap "same as last
        // time" shortcut next round. In the same transaction: the user row is
        // known to exist (asserted above), and the memory must never diverge
        // from a committed expense.
        await tx.user.update({
          where: { id: data.userId },
          data: { lastProjectId: data.projectId, lastCategory: data.category },
        });

        return expense;
      });
    } catch (error) {
      // Only an invoice-number collision is retryable; anything else is real.
      if (!isInvoiceNumberCollision(error)) throw error;
      if (attempt >= INVOICE_NUMBER_RETRIES) {
        // Log the underlying cause so a genuine failure is diagnosable instead
        // of being hidden behind a generic message.
        console.error(
          `[expenses] could not allocate an invoice number for project ` +
            `${data.projectId} after ${attempt} attempts`,
          error,
        );
        throw new ValidationError(
          "شماره‌گذاری فاکتور با مشکل مواجه شد؛ لطفاً دوباره تلاش کنید",
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
export async function softDeleteExpense(
  id: string,
  requestingUserId: string | null,
  options: { reason?: string | null; expectedUpdatedAt?: Date } = {},
) {
  if (requestingUserId) {
    await requireAdmin(requestingUserId, "فقط مدیر می‌تواند هزینه را حذف کند");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.expense.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("هزینه یافت نشد");
    assertNotStale(before.updatedAt, options.expectedUpdatedAt);

    const updated = await tx.expense.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedReason: options.reason ?? null,
        deletedByType: "ADMIN_DASHBOARD",
        deletedByUserId: requestingUserId,
      },
      include: EXPENSE_INCLUDE,
    });

    await writeAuditLog(tx, {
      expenseId: id,
      action: "DELETE",
      actorType: "ADMIN_DASHBOARD",
      actorUserId: requestingUserId,
      reason: options.reason ?? null,
      before: snapshotExpense(before),
      after: snapshotExpense(updated),
    });

    return updated;
  });
}

/**
 * Employee self-cancellation: only the person who recorded the expense may
 * cancel it, and only inside the configured window. The window is read from the
 * database at call time, so a dashboard change applies immediately.
 */
export async function cancelExpense(
  id: string,
  requestingUserId: string,
  options: { reason?: string | null } = {},
) {
  const user = await getUserById(requestingUserId);
  if (!user) throw new NotFoundError("کاربر یافت نشد");
  if (!user.isActive) throw new ForbiddenError("کاربر غیرفعال است");

  const settings = await getCancellationSettings();
  if (settings.windowMinutes <= 0) {
    throw new ForbiddenError("امکان لغو هزینه توسط ثبت‌کننده غیرفعال است");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.expense.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("هزینه یافت نشد");
    if (before.userId !== requestingUserId) {
      throw new ForbiddenError("شما فقط می‌توانید هزینه‌ای را که خودتان ثبت کرده‌اید لغو کنید");
    }

    const deadline =
      before.createdAt.getTime() + settings.windowMinutes * 60_000;
    if (Date.now() > deadline) {
      throw new ForbiddenError("مهلت لغو این هزینه گذشته است");
    }

    const updated = await tx.expense.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedReason: options.reason ?? "لغو توسط ثبت‌کننده",
        deletedByType: "EMPLOYEE",
        deletedByUserId: requestingUserId,
      },
      include: EXPENSE_INCLUDE,
    });

    await writeAuditLog(tx, {
      expenseId: id,
      action: "CANCEL",
      actorType: "EMPLOYEE",
      actorUserId: requestingUserId,
      reason: options.reason ?? null,
      before: snapshotExpense(before),
      after: snapshotExpense(updated),
    });

    return updated;
  });
}

/** Brings a soft-deleted expense back, clearing every deletion marker. */
export async function restoreExpense(
  id: string,
  requestingUserId: string | null,
) {
  if (requestingUserId) {
    await requireAdmin(requestingUserId, "فقط مدیر می‌تواند هزینه را بازگرداند");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.expense.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("هزینه یافت نشد");
    if (!before.deletedAt) throw new ValidationError("این هزینه حذف نشده است");

    const updated = await tx.expense.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedReason: null,
        deletedByType: null,
        deletedByUserId: null,
      },
      include: EXPENSE_INCLUDE,
    });

    await writeAuditLog(tx, {
      expenseId: id,
      action: "RESTORE",
      actorType: "ADMIN_DASHBOARD",
      actorUserId: requestingUserId,
      before: snapshotExpense(before),
      after: snapshotExpense(updated),
    });

    return updated;
  });
}

/**
 * Admin edit from the dashboard. The row's `updatedAt` is the concurrency
 * token: when the caller's value is stale the edit is refused, so two admins
 * are never silently overwritten. The audit row and the edit share a
 * transaction.
 */
export async function editExpense(
  id: string,
  requestingUserId: string | null,
  input: EditExpenseInput,
) {
  const data = editExpenseSchema.parse(input);
  if (requestingUserId) {
    await requireAdmin(requestingUserId, "فقط مدیر می‌تواند هزینه را ویرایش کند");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.expense.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("هزینه یافت نشد");
    assertNotStale(before.updatedAt, data.expectedUpdatedAt);

    if (data.projectId && data.projectId !== before.projectId) {
      const project = await tx.project.findUnique({
        where: { id: data.projectId },
        select: { id: true },
      });
      if (!project) throw new ValidationError("پروژه انتخاب‌شده وجود ندارد");
    }
    if (data.userId && data.userId !== before.userId) {
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true },
      });
      if (!user) throw new ValidationError("کاربر انتخاب‌شده وجود ندارد");
    }

    const updated = await tx.expense.update({
      where: { id },
      data: {
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.amount !== undefined ? { amount: BigInt(data.amount) } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.expenseDate !== undefined
          ? { expenseDate: data.expenseDate }
          : {}),
      },
      include: EXPENSE_INCLUDE,
    });

    await writeAuditLog(tx, {
      expenseId: id,
      action: "EDIT",
      actorType: "ADMIN_DASHBOARD",
      actorUserId: requestingUserId,
      before: snapshotExpense(before),
      after: snapshotExpense(updated),
    });

    return updated;
  });
}

/** The change history of one expense, newest first. */
export async function getExpenseHistory(id: string) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!expense) throw new NotFoundError("هزینه یافت نشد");
  return listAuditLogs(id);
}

/**
 * Soft-deleted expenses, newest first. Backs the dashboard's
 * "نمایش حذف‌شده‌ها" view; every other listing keeps excluding them.
 */
export async function listDeletedExpenses(
  filters: { projectId?: string; page?: number; pageSize?: number } = {},
): Promise<ExpenseListResult> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const where: Prisma.ExpenseWhereInput = {
    deletedAt: { not: null },
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.expense.findMany({
      where,
      include: EXPENSE_INCLUDE,
      orderBy: [{ deletedAt: "desc" }, { createdAt: "desc" }],
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

/**
 * Remembers which groups an expense was announced in, so a later correction can
 * be posted to the same places. Best-effort: a failure here is logged by the
 * caller, never surfaced to the recorder.
 */
export async function recordExpenseAnnouncement(
  expenseId: string,
  chats: AnnouncedChat[],
) {
  return prisma.expense.update({
    where: { id: expenseId },
    data: { announcedChats: chats as Prisma.InputJsonValue },
  });
}

/** Admin-only guard shared by the correction writes. */
async function requireAdmin(userId: string, message: string) {
  const user = await getUserById(userId);
  if (!user) throw new NotFoundError("کاربر درخواست‌دهنده یافت نشد");
  if (user.role !== "ADMIN") throw new ForbiddenError(message);
  return user;
}

/**
 * Optimistic-concurrency check. The dashboard sends back the `updatedAt` it
 * rendered; a mismatch means someone edited the row in between, and the write
 * is refused rather than clobbering the other change.
 */
function assertNotStale(updatedAt: Date, expected?: Date) {
  if (expected && updatedAt.getTime() !== expected.getTime()) {
    throw new ConflictError(
      "این هزینه هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید",
    );
  }
}
