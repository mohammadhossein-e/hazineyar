import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  UPLOAD_DIR: z.string().default("./uploads"),
  ADMIN_PASSWORD: z.string().min(1).default("admin123"),
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_CONVERSATION_TTL_MINUTES: z.coerce.number().int().min(1).default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration -> ${issues}`);
}

const isProduction = process.env.NODE_ENV === "production";
const adminPasswordProvided = "ADMIN_PASSWORD" in process.env;
const adminPassword = parsed.data.ADMIN_PASSWORD;

// The dashboard's only credential must never ship weak by default. Loading a
// production build with the seeded fallback (or something trivially guessable)
// fails fast; development only logs a reminder so `npm run dev` stays easy.
if (isProduction) {
  if (!adminPasswordProvided) {
    throw new Error(
      "ADMIN_PASSWORD must be set in production: refusing to start with the built-in default password",
    );
  }
  if (adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
  }
} else if (!adminPasswordProvided || adminPassword.length < 8) {
  console.warn(
    "[config] ADMIN_PASSWORD is missing or weaker than 8 characters. " +
      "It works for local development only; set a strong ADMIN_PASSWORD before deploying.",
  );
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
  uploadDir: parsed.data.UPLOAD_DIR,
  adminPassword,
  telegramMode: parsed.data.TELEGRAM_MODE,
  telegramWebhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
  telegramConversationTtlMs:
    parsed.data.TELEGRAM_CONVERSATION_TTL_MINUTES * 60 * 1000,
} as const;
