-- Invoice numbers used to be derived from the row COUNT per project, which
-- drifts from the true maximum as soon as a number is skipped (e.g. a row was
-- deleted or a number was consumed without being reused). Once count+1 lands on
-- an already-used number, every insert collides on the (projectId,
-- invoiceNumber) unique index and the retry loop recomputes the same value.
--
-- This per-project counter becomes the source of truth. It is seeded below from
-- the largest numeric suffix already in use (malformed values ignored, deleted
-- rows included) and createExpense() advances it atomically inside the insert
-- transaction, so two concurrent creates can never receive the same number.

-- CreateTable
CREATE TABLE "ProjectInvoiceCounter" (
    "projectId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvoiceCounter_pkey" PRIMARY KEY ("projectId")
);

-- Seed from existing data so the first create after migrating continues past
-- every number already in use instead of restarting at 1. Only well-formed
-- "invoice_<digits>" values count; anything else (legacy/manual rows) is
-- treated as 0. Soft-deleted rows are included, so their numbers are never
-- reissued.
INSERT INTO "ProjectInvoiceCounter" ("projectId", "lastNumber", "updatedAt")
SELECT "projectId",
       MAX(
           CASE
               WHEN "invoiceNumber" ~ '^invoice_[0-9]{1,9}$'
               THEN (SUBSTRING("invoiceNumber" FROM 'invoice_([0-9]{1,9})'))::INTEGER
               ELSE 0
           END
       ),
       CURRENT_TIMESTAMP
FROM "Expense"
GROUP BY "projectId";

-- AddForeignKey
ALTER TABLE "ProjectInvoiceCounter" ADD CONSTRAINT "ProjectInvoiceCounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
