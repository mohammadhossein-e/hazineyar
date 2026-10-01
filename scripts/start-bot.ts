/**
 * Long-polling entrypoint for the Telegram bot.
 *
 * Usage:
 *   npm run bot:dev              (or: npx tsx scripts/start-bot.ts)
 *
 * Runs from the same `.env` as the web app. Conversation state lives in
 * memory, so exactly one polling process may run at a time.
 */
import "dotenv/config";
import { createBot } from "../src/adapters/telegram/bot";
import { config } from "../src/lib/config";

async function main(): Promise<void> {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot");
  }
  if (config.telegramMode !== "polling") {
    throw new Error(
      `TELEGRAM_MODE is "${config.telegramMode}"; this script only polls. ` +
        "Use the webhook route at /api/telegram/webhook instead.",
    );
  }

  const bot = createBot(config.telegramBotToken);

  await bot.api.setMyCommands([
    { command: "start", description: "معرفی ربات" },
    { command: "expense", description: "ثبت هزینه جدید" },
    { command: "cancel", description: "لغو ثبت هزینه فعلی" },
    { command: "help", description: "راهنما" },
  ]);

  await bot.init();
  console.log(
    `[telegram] polling as @${bot.botInfo.username} (${bot.botInfo.first_name})`,
  );

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`[telegram] connected to @${info.username}`),
  });
}

main().catch((error) => {
  console.error("[telegram] fatal:", error);
  process.exit(1);
});
