-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "announcedChats" JSONB;

-- Backfill: carry the single legacy announcement into the new list shape. The
-- old message id was a string; only a numeric one is kept as a number.
UPDATE "Expense"
SET "announcedChats" = jsonb_build_array(
  jsonb_build_object(
    'chatId', "announcedGroupChatId",
    'messageId',
    CASE
      WHEN "announcedMessageId" ~ '^[0-9]+$' THEN "announcedMessageId"::int
      ELSE NULL
    END
  )
)
WHERE "announcedGroupChatId" IS NOT NULL;

-- AlterTable
ALTER TABLE "Expense"
DROP COLUMN "announcedGroupChatId",
DROP COLUMN "announcedMessageId";
