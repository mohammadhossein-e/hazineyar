/**
 * Bootstraps the environment for a test script.
 *
 * Must be imported as the *first* import of every test file, before any module
 * that reads `DATABASE_URL` (in particular `src/lib/db`). It:
 *   1. loads `.env`,
 *   2. forces `DATABASE_URL` to `TEST_DATABASE_URL`,
 *   3. refuses to continue unless the target database name ends in `_test`.
 *
 * This keeps the automated suites away from the developer's manual database.
 */
import "dotenv/config";

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "";
  } catch {
    return url.split("/").pop()?.split("?")[0] ?? "";
  }
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    "FATAL: TEST_DATABASE_URL is not set. Add it to .env (see .env.example).",
  );
  process.exit(1);
}

const name = databaseName(testUrl);
if (!name.endsWith("_test")) {
  console.error(
    `FATAL: refusing to run tests: TEST_DATABASE_URL points at "${name}", ` +
      `which does not end in "_test".`,
  );
  process.exit(1);
}

// Point the app (config, prisma client, Next handlers) at the test database.
process.env.DATABASE_URL = testUrl;

console.log(`[test] database: ${name}`);
