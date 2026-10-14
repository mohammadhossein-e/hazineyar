/**
 * Launches a test script with `DATABASE_URL` pointed at `TEST_DATABASE_URL`.
 *
 * Used by the npm scripts (`test:expenses`, `test:bot`, `test:admin`) so a bare
 * `npm run test:*` can never reach the developer's manual database. The target
 * script also re-checks the database name (see `scripts/test-env.ts`).
 *
 * Usage: node scripts/run-with-test-db.mjs <script.ts>
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config();

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/run-with-test-db.mjs <script.ts>");
  process.exit(1);
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    "FATAL: TEST_DATABASE_URL is not set. Add it to .env (see .env.example).",
  );
  process.exit(1);
}

const name = (() => {
  try {
    return new URL(testUrl).pathname.replace(/^\//, "");
  } catch {
    return testUrl.split("/").pop()?.split("?")[0] ?? "";
  }
})();

if (!name.endsWith("_test")) {
  console.error(
    `FATAL: refusing to run tests: TEST_DATABASE_URL points at "${name}", ` +
      `which does not end in "_test".`,
  );
  process.exit(1);
}

const result = spawnSync("npx", ["tsx", target], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});

process.exit(result.status ?? 1);
