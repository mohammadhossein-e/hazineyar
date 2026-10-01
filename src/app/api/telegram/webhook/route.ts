import { createBot } from "@/adapters/telegram/bot";
import { config } from "@/lib/config";

/**
 * POST /api/telegram/webhook — alternative to long polling.
 *
 * Enable it by pointing Telegram at this URL and setting:
 *   TELEGRAM_MODE=webhook
 *   TELEGRAM_WEBHOOK_SECRET=<token>
 *
 * The secret is Telegram's `secret_token` header, checked here so the public
 * endpoint cannot be used to inject fake updates. Only one delivery mode may
 * be active at a time: polling and webhooks will fight over updates. The route
 * therefore answers 404 (not "not authenticated") when polling is configured,
 * and without a secret it refuses every update outright.
 */
let bot: ReturnType<typeof createBot> | null = null;

function getBot() {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for the webhook route");
  }
  bot ??= createBot(config.telegramBotToken);
  return bot;
}

export async function POST(request: Request) {
  const { telegramMode, telegramWebhookSecret: secret } = config;

  if (telegramMode !== "webhook") {
    // Neither the secret nor the bot is required in polling mode, but an open
    // webhook would still accept forged updates. As far as this deployment is
    // concerned the endpoint does not exist.
    return Response.json({ ok: false }, { status: 404 });
  }

  if (!secret) {
    console.error(
      "[telegram] TELEGRAM_MODE=webhook requires TELEGRAM_WEBHOOK_SECRET; refusing updates",
    );
    return Response.json({ ok: false }, { status: 403 });
  }

  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  if (provided !== secret) {
    return Response.json({ ok: false }, { status: 403 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    await getBot().handleUpdate(update as Parameters<
      ReturnType<typeof getBot>["handleUpdate"]
    >[0]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[telegram] webhook update failed:", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
