/**
 * Creates the test database idempotently, inside the same Postgres container
 * used by `docker compose`. Init scripts do not run on an existing volume, so
 * this talks to the running container via `docker compose exec`.
 *
 * Usage: npm run db:test:create
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("FATAL: TEST_DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const parsed = new URL(testUrl);
const dbName = parsed.pathname.replace(/^\//, "");
const user = decodeURIComponent(parsed.username || "hazineyar");

if (!dbName || !dbName.endsWith("_test")) {
  console.error(
    `FATAL: TEST_DATABASE_URL database name "${dbName}" must end in "_test".`,
  );
  process.exit(1);
}

function psql(sql) {
  return spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      user,
      "-d",
      "postgres",
      "-tAc",
      sql,
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
}

const exists = psql(
  `SELECT 1 FROM pg_database WHERE datname='${dbName}'`,
);
if (exists.status !== 0) {
  console.error(exists.stderr || "Failed to query Postgres via docker compose.");
  process.exit(1);
}

if (exists.stdout.trim() === "1") {
  console.log(`Test database "${dbName}" already exists.`);
} else {
  const create = psql(`CREATE DATABASE "${dbName}"`);
  if (create.status !== 0) {
    console.error(create.stderr || "Failed to create the test database.");
    process.exit(1);
  }
  console.log(`Created test database "${dbName}".`);
}

console.log("Now run: npm run db:test:migrate");
