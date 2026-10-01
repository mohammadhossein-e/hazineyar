-- Protects invoice numbering from a concurrent-create race: two writers can
-- both count the same used numbers and insert a duplicate. The unique pair
-- makes the second insert fail; createExpense() retries with a fresh number.
CREATE UNIQUE INDEX "Expense_projectId_invoiceNumber_key" ON "Expense"("projectId", "invoiceNumber");