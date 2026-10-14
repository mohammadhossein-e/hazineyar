-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('EDIT', 'DELETE', 'CANCEL', 'RESTORE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN_DASHBOARD', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "deletedByType" "AuditActorType",
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletedReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ExpenseAuditLog" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseAuditLog_expenseId_createdAt_idx" ON "ExpenseAuditLog"("expenseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAuditLog" ADD CONSTRAINT "ExpenseAuditLog_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
