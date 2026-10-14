/**
 * Runs an HTTP-driven test script against a Next dev server wired to the test
 * database. It starts the server on a dedicated port (default 3101), waits for
 * /api/health, runs the script with BASE_URL/TEST_BASE_URL pointing at it, and
 * shuts the server down afterwards. The developer's own server and database are
 * never involved.
 *
 * Usage: node scripts/run-e2e-with-test-db.mjs <script.ts>
 */
import { spawn, spawnSync } from "node:child_process";
import { config } from "dotenv";

config();

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/run-e2e-with-test-db.mjs <script.ts>");
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
    `FATAL: refusing to run tests: TEST_DATABASE_URL points at "${name}".`,
  );
  process.exit(1);
}

const port = process.env.TEST_PORT ?? "3101";
const baseUrl = `http://localhost:${port}`;

const env = { ...process.env, DATABASE_URL: testUrl };

async function waitForHealth(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

console.log(`[test] starting Next dev on ${baseUrl} (db: ${name})`);
const server = spawn("npx", ["next", "dev", "-p", port], {
  stdio: ["ignore", "pipe", "pipe"],
  env,
});

server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

let code = 1;
try {
  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("FATAL: Next dev server did not become healthy in time.");
  } else {
    const result = spawnSync("npx", ["tsx", target], {
      stdio: "inherit",
      env: { ...env, BASE_URL: baseUrl, TEST_BASE_URL: baseUrl },
    });
    code = result.status ?? 1;
  }
} finally {
  server.kill("SIGTERM");
  // Give Next a moment to release the port.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

process.exit(code);
