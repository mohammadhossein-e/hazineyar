/**
 * Prints a fingerprint of the *dev* database: row counts plus a SHA-256
 * checksum of the rows in the key tables. Capture it before and after a test
 * run to prove the suites never touched manual data.
 *
 * Usage:
 *   DATABASE_URL=postgresql://.../hazineyar npx tsx scripts/dev-db-snapshot.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

async function checksum(rows: unknown[]): Promise<string> {
  const sorted = rows.map(stable).sort();
  const hash = createHash("sha256");
  for (const row of sorted) hash.update(row).update("\n");
  return hash.digest("hex");
}

async function main() {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const projects = await prisma.project.findMany({ orderBy: { id: "asc" } });
  const expenses = await prisma.expense.findMany({ orderBy: { id: "asc" } });
  const links = await prisma.userProject.findMany({ orderBy: { id: "asc" } });
  const linkedChats = await prisma.linkedChat.findMany({ orderBy: { id: "asc" } });
  const access = await prisma.accessRequest.findMany({ orderBy: { id: "asc" } });
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  const audit = await prisma.expenseAuditLog.findMany({ orderBy: { id: "asc" } });

  const snapshot = {
    counts: {
      users: users.length,
      projects: projects.length,
      expenses: expenses.length,
      userProjects: links.length,
      linkedChats: linkedChats.length,
      accessRequests: access.length,
      settings: settings.length,
      auditLogs: audit.length,
    },
    checksums: {
      users: await checksum(users),
      projects: await checksum(projects),
      expenses: await checksum(expenses),
      userProjects: await checksum(links),
      linkedChats: await checksum(linkedChats),
      accessRequests: await checksum(access),
      settings: await checksum(settings),
      auditLogs: await checksum(audit),
    },
  };

  console.log(JSON.stringify(snapshot, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
