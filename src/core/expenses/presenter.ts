import type { Expense, Prisma } from "@prisma/client";
import { formatJalaliUtc, type DateRange } from "@/lib/jalali";
import { categoryLabel } from "./categories";
import type { ExpenseSummary } from "./service";

export type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: { project: true; user: true };
}>;

export type PresentedExpense = {
  id: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string | null;
  userId: string;
  userName: string | null;
  category: Expense["category"];
  categoryLabel: string;
  /** Whole Toman. Converted from BigInt because JSON has no BigInt type. */
  amount: number;
  description: string | null;
  invoiceFilePath: string | null;
  invoiceUrl: string | null;
  expenseDate: string;
  expenseDateJalali: string;
  createdAt: string;
  deletedAt: string | null;
};

/**
 * Channel-agnostic JSON view of an expense. Every layer (API, Telegram, future
 * dashboard) should render expenses through this so `amount` is never left as a
 * BigInt, which `JSON.stringify` refuses to serialize.
 */
export function presentExpense(
  expense: Expense | ExpenseWithRelations,
): PresentedExpense {
  const withRelations = expense as Partial<ExpenseWithRelations>;

  return {
    id: expense.id,
    invoiceNumber: expense.invoiceNumber,
    projectId: expense.projectId,
    projectName: withRelations.project?.name ?? null,
    userId: expense.userId,
    userName: withRelations.user?.name ?? null,
    category: expense.category,
    categoryLabel: categoryLabel(expense.category),
    amount: Number(expense.amount),
    description: expense.description,
    invoiceFilePath: expense.invoiceFilePath,
    invoiceUrl: expense.invoiceFilePath
      ? `/api/invoices/${encodeURIComponent(expense.invoiceFilePath)}`
      : null,
    expenseDate: expense.expenseDate.toISOString(),
    expenseDateJalali: formatJalaliUtc(expense.expenseDate),
    createdAt: expense.createdAt.toISOString(),
    deletedAt: expense.deletedAt ? expense.deletedAt.toISOString() : null,
  };
}

export function presentExpenses(expenses: (Expense | ExpenseWithRelations)[]) {
  return expenses.map(presentExpense);
}

function presentPeriod(range: DateRange) {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    /** Jalali label of the period start, handy for bot messages. */
    fromJalali: formatJalaliUtc(range.from),
  };
}

export function presentSummary(summary: ExpenseSummary) {
  const toAmounts = (p: { total: bigint; count: number }) => ({
    total: Number(p.total),
    count: p.count,
  });

  return {
    projectId: summary.projectId,
    today: toAmounts(summary.today),
    thisWeek: toAmounts(summary.thisWeek),
    thisMonth: toAmounts(summary.thisMonth),
    periods: {
      today: presentPeriod(summary.ranges.today),
      thisWeek: presentPeriod(summary.ranges.thisWeek),
      thisMonth: presentPeriod(summary.ranges.thisMonth),
    },
  };
}
