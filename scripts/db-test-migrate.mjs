/**
 * Applies migrations to the test database (TEST_DATABASE_URL).
 * Run after `npm run db:test:create`.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("FATAL: TEST_DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});

process.exit(result.status ?? 1);
