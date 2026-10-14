-- Remember the last project/category each user recorded against, so the bot
-- can offer a one-tap "same as last time" shortcut. Both are nullable: an
-- account that has never recorded keeps NULL and is simply not offered it.
ALTER TABLE "User" ADD COLUMN "lastProjectId" TEXT;
ALTER TABLE "User" ADD COLUMN "lastCategory" "ExpenseCategory";
