/**
 * Long-polling entrypoint for the Bale bot.
 *
 * Usage:
 *   npm run bale:dev             (or: npx tsx scripts/start-bale.ts)
 *
 * Runs from the same `.env` as the web app. Bale speaks the Telegram Bot API, so
 * this is the Telegram entrypoint pointed at Bale's host. Conversation state
 * lives in memory, so exactly one polling process may run at a time.
 */
import "dotenv/config";
import { createBaleBot } from "../src/adapters/bale";
import { config } from "../src/lib/config";

async function main(): Promise<void> {
  if (!config.baleBotToken) {
    throw new Error("BALE_BOT_TOKEN is required to start the Bale bot");
  }

  const bot = createBaleBot(config.baleBotToken);

  // Command menus are optional: a Bale bot that has not been published may
  // reject setMyCommands, so a failure here must not stop polling.
  await bot.api
    .setMyCommands([
      { command: "start", description: "معرفی ربات" },
      { command: "expense", description: "ثبت هزینه جدید" },
      { command: "cancel", description: "لغو ثبت هزینه فعلی" },
      { command: "help", description: "راهنما" },
    ])
    .catch((error) => console.warn("[bale] could not set the command menu:", error));

  await bot.init();
  console.log(
    `[bale] polling as @${bot.botInfo.username} (${bot.botInfo.first_name})`,
  );

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`[bale] connected to @${info.username}`),
  });
}

main().catch((error) => {
  console.error("[bale] fatal:", error);
  process.exit(1);
});
