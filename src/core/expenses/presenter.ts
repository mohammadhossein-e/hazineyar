import type { Expense, ExpenseAuditLog, Prisma } from "@prisma/client";
import { formatJalaliUtc, type DateRange } from "@/lib/jalali";
import { categoryLabel } from "./categories";
import { parseAnnouncedChats, type AnnouncedChat } from "./announcement";
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
  updatedAt: string;
  deletedAt: string | null;
  deletedReason: string | null;
  deletedByType: Expense["deletedByType"];
  announcedChats: AnnouncedChat[];
  /** Set by the dashboard when it knows an EDIT entry exists in the history. */
  isEdited?: boolean;
};

/**
 * Channel-agnostic JSON view of an expense. Every layer (API, Telegram, future
 * dashboard) should render expenses through this so `amount` is never left as a
 * BigInt, which `JSON.stringify` refuses to serialize.
 */
export function presentExpense(
  expense: Expense | ExpenseWithRelations,
  options: { isEdited?: boolean } = {},
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
    updatedAt: expense.updatedAt.toISOString(),
    deletedAt: expense.deletedAt ? expense.deletedAt.toISOString() : null,
    deletedReason: expense.deletedReason,
    deletedByType: expense.deletedByType,
    announcedChats: parseAnnouncedChats(expense.announcedChats),
    ...(options.isEdited !== undefined ? { isEdited: options.isEdited } : {}),
  };
}

export function presentExpenses(expenses: (Expense | ExpenseWithRelations)[]) {
  return expenses.map((expense) => presentExpense(expense));
}

export type PresentedAuditLog = {
  id: string;
  action: ExpenseAuditLog["action"];
  actionLabel: string;
  actorType: ExpenseAuditLog["actorType"];
  actorLabel: string;
  actorUserId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  createdAtJalali: string;
};

const AUDIT_ACTION_LABELS: Record<ExpenseAuditLog["action"], string> = {
  EDIT: "ویرایش",
  DELETE: "حذف",
  CANCEL: "لغو",
  RESTORE: "بازگردانی",
};

const AUDIT_ACTOR_LABELS: Record<ExpenseAuditLog["actorType"], string> = {
  ADMIN_DASHBOARD: "مدیر (داشبورد)",
  EMPLOYEE: "ثبت‌کننده (ربات)",
};

export function presentAuditLog(log: ExpenseAuditLog): PresentedAuditLog {
  return {
    id: log.id,
    action: log.action,
    actionLabel: AUDIT_ACTION_LABELS[log.action],
    actorType: log.actorType,
    actorLabel: AUDIT_ACTOR_LABELS[log.actorType],
    actorUserId: log.actorUserId,
    reason: log.reason,
    before: log.before,
    after: log.after,
    createdAt: log.createdAt.toISOString(),
    createdAtJalali: formatJalaliUtc(log.createdAt),
  };
}

export function presentAuditLogs(logs: ExpenseAuditLog[]) {
  return logs.map(presentAuditLog);
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
