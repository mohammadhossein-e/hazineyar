import { prisma } from "@/lib/db";
import { Prisma, type AuditAction, type AuditActorType, type Expense } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * The JSON shape of a before/after snapshot. `amount` is turned into a number
 * and dates into ISO strings because the audit columns are JSONB and a BigInt
 * cannot be serialized.
 */
export type ExpenseSnapshot = {
  id: string;
  projectId: string;
  userId: string;
  category: string;
  amount: number;
  description: string | null;
  invoiceFilePath: string | null;
  invoiceNumber: string;
  expenseDate: string;
  deletedAt: string | null;
};

export function snapshotExpense(expense: Expense): ExpenseSnapshot {
  return {
    id: expense.id,
    projectId: expense.projectId,
    userId: expense.userId,
    category: expense.category,
    amount: Number(expense.amount),
    description: expense.description,
    invoiceFilePath: expense.invoiceFilePath,
    invoiceNumber: expense.invoiceNumber,
    expenseDate: expense.expenseDate.toISOString(),
    deletedAt: expense.deletedAt ? expense.deletedAt.toISOString() : null,
  };
}

export type AuditEntry = {
  expenseId: string;
  action: AuditAction;
  actorType: AuditActorType;
  actorUserId?: string | null;
  reason?: string | null;
  before?: ExpenseSnapshot | null;
  after?: ExpenseSnapshot | null;
};

/**
 * Writes one audit row. Callers pass the transaction client that also performs
 * the change, so the log and the change commit (or roll back) together: there
 * is never a recorded action without a matching write, and never a write
 * without a corresponding audit row.
 */
export async function writeAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.expenseAuditLog.create({
    data: {
      expenseId: entry.expenseId,
      action: entry.action,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      reason: entry.reason ?? null,
      before: entry.before
        ? (entry.before as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      after: entry.after
        ? (entry.after as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });
}

/** The change history of one expense, newest first. */
export async function listAuditLogs(expenseId: string) {
  return prisma.expenseAuditLog.findMany({
    where: { expenseId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * Given a page of expense ids, returns the subset with at least one EDIT entry,
 * so the dashboard can badge them without an N+1 query per row.
 */
export async function getEditedExpenseIds(
  expenseIds: string[],
): Promise<Set<string>> {
  if (expenseIds.length === 0) return new Set();
  const rows = await prisma.expenseAuditLog.findMany({
    where: { expenseId: { in: expenseIds }, action: "EDIT" },
    select: { expenseId: true },
    distinct: ["expenseId"],
  });
  return new Set(rows.map((row) => row.expenseId));
}
