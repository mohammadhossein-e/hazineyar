/**
 * Lightweight end-to-end check for the expense API.
 *
 * Usage:
 *   1. docker compose up -d
 *   2. npx prisma migrate dev && npx prisma db seed
 *   3. npm run dev
 *   4. npm run test:expenses            (or: npx tsx scripts/test-expenses.ts)
 *
 * It resolves the seeded users straight from the database, then drives the
 * HTTP API through create -> list -> filter -> summary -> upload -> delete.
 * No test framework is involved on purpose.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";
import { toGregorian } from "jalaali-js";
import { formatJalaliUtc } from "../src/lib/jalali";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const P = {
  saadatabad: "proj-saadatabad",
  pasdaran: "proj-pasdaran",
  vank: "proj-vank",
} as const;

/** Smallest valid PNG, used for the invoice upload checks. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let passed = 0;
let failed = 0;
let createdExpenseId: string | null = null;
let uploadedName: string | null = null;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label}`);
    if (detail !== undefined) {
      console.error(`        ${JSON.stringify(detail).slice(0, 400)}`);
    }
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * The dashboard's session token, recomputed the way lib/auth.sessionToken()
 * does. Write endpoints (POST/DELETE) are admin-gated, so every write below
 * carries it; GET endpoints stay public and are tested as such.
 */
const SESSION_COOKIE_VALUE = createHmac(
  "sha256",
  process.env.ADMIN_PASSWORD ?? "admin123",
)
  .update("hazineyar.dashboard.v1")
  .digest("hex");
const ADMIN_COOKIE = `hazineyar_admin=${SESSION_COOKIE_VALUE}`;

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const headers = new Headers();
  // Write endpoints are admin-gated; GET stays public (and is tested as such).
  if (method !== "GET") headers.set("cookie", ADMIN_COOKIE);

  const init: RequestInit = { method, headers };
  if (body instanceof FormData) {
    init.body = body; // no content-type: the multipart boundary is generated
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/**
 * exceljs ships its own `interface Buffer extends ArrayBuffer`, so the Node
 * Buffer we hold is cast through ArrayBuffer to satisfy its read path.
 */
function loadXlsx(workbook: ExcelJS.Workbook, data: Buffer): Promise<ExcelJS.Workbook> {
  return workbook.xlsx.load(data as unknown as ArrayBuffer);
}

/** Hits the admin-gated Excel export with the shared session cookie. */
async function exportFetch(query: string) {
  const res = await fetch(`${BASE_URL}/api/expenses/export${query}`, {
    headers: { Cookie: ADMIN_COOKIE },
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    disposition: res.headers.get("content-disposition") ?? "",
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

async function main() {
  console.log(`Testing ${BASE_URL}`);

  const users = await prisma.user.findMany({
    where: { channel: "telegram" },
    select: { id: true, name: true, role: true },
  });
  const byExternal = Object.fromEntries(
    (await prisma.user.findMany({
      where: { channel: "telegram" },
      select: { id: true, externalId: true },
    })).map((u) => [u.externalId, u.id]),
  );
  const admin = byExternal.admin001;
  const reza = byExternal.reza001;
  const ali = byExternal.ali001;

  if (!admin || !reza || !ali) {
    throw new Error("Seed data missing. Run: npx prisma db seed");
  }
  console.log(`Seeded users: ${users.map((u) => `${u.name}(${u.role})`).join(", ")}`);

  // ---------------------------------------------------------------- health
  section("Health");
  {
    const { status, json } = await api("GET", "/api/health");
    check("GET /api/health -> 200", status === 200, json);
    check("database connected", json?.database === "connected", json);
  }

  // ---------------------------------------------------------------- create
  section("Create expense");
  {
    // Numbering is count-based and sequential **per project**, counting every
    // row ever made for the project (soft-deleted ones included). The DB count
    // is therefore the exact expected number, independent of earlier test runs
    // that left rows behind.
    const saadTotal = await prisma.expense.count({ where: { projectId: P.saadatabad } });
    const vankTotal = await prisma.expense.count({ where: { projectId: P.vank } });
    const padded = (n: number) => `invoice_${String(n).padStart(3, "0")}`;

    const { status, json } = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "MATERIALS",
      amount: 1_250_000,
      description: "سیمان و میلگرد",
      expenseDate: new Date().toISOString(),
    });
    check("POST /api/expenses -> 201", status === 201, json);
    check("returns amount as a number", typeof json?.amount === "number", json);
    check("returns Persian category label", json?.categoryLabel === "مصالح", json);
    check("returns Jalali date", typeof json?.expenseDateJalali === "string", json);
    check("includes project and user", !!json?.projectName && !!json?.userName, json);

    createdExpenseId = json?.id ?? null;
    check("has an id", !!createdExpenseId, json);
    check(
      "first invoice number follows the existing project count",
      json?.invoiceNumber === padded(saadTotal + 1),
      { got: json?.invoiceNumber, want: saadTotal + 1 },
    );

    // Sequential, per project.
    const second = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "WAGES",
      amount: 500_000,
      expenseDate: new Date().toISOString(),
    });
    check(
      "invoice numbers increment per project within this run",
      json?.invoiceNumber === padded(saadTotal + 1) &&
        second.json?.invoiceNumber === padded(saadTotal + 2),
      { first: json?.invoiceNumber, second: second.json?.invoiceNumber },
    );

    // Another project restarts the sequence from its own count.
    const otherProject = await api("POST", "/api/expenses", {
      projectId: P.vank,
      userId: ali,
      category: "TRANSPORT",
      amount: 300_000,
      expenseDate: new Date().toISOString(),
    });
    check(
      "other project restarts its own sequence",
      otherProject.json?.invoiceNumber === padded(vankTotal + 1),
      { got: otherProject.json?.invoiceNumber, want: vankTotal + 1 },
    );
  }

  // ------------------------------------------------------------ validation
  section("Validation and permissions");
  {
    const badCategory = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "NOPE",
      amount: 1000,
      expenseDate: new Date().toISOString(),
    });
    check("unknown category -> 400", badCategory.status === 400, badCategory.json);
    check("error shape has message + code", !!badCategory.json?.error?.message && !!badCategory.json?.error?.code, badCategory.json);
    check("error lists allowed categories", Array.isArray(badCategory.json?.error?.details), badCategory.json);

    const decimal = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "WAGES",
      amount: 1000.5,
      expenseDate: new Date().toISOString(),
    });
    check("decimal amount -> 400", decimal.status === 400, decimal.json);

    const negative = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "WAGES",
      amount: -5,
      expenseDate: new Date().toISOString(),
    });
    check("negative amount -> 400", negative.status === 400, negative.json);

    // علی is only linked to ونک.
    const forbidden = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: ali,
      category: "TOOLS",
      amount: 1000,
      expenseDate: new Date().toISOString(),
    });
    check("employee on a project they are not linked to -> 403", forbidden.status === 403, forbidden.json);

    const adminOnAny = await api("POST", "/api/expenses", {
      projectId: P.pasdaran,
      userId: admin,
      category: "WORKER_FOOD",
      amount: 200_000,
      expenseDate: new Date().toISOString(),
    });
    check("admin can record on any project -> 201", adminOnAny.status === 201, adminOnAny.json);

    const missingProject = await api("POST", "/api/expenses", {
      projectId: "does-not-exist",
      userId: admin,
      category: "OTHER",
      amount: 1000,
      expenseDate: new Date().toISOString(),
    });
    check("unknown project -> 404", missingProject.status === 404, missingProject.json);

    const badDateRange = await api(
      "GET",
      "/api/expenses?dateFrom=2026-01-10&dateTo=2026-01-01",
    );
    check("dateFrom after dateTo -> 400", badDateRange.status === 400, badDateRange.json);

    const badPageSize = await api("GET", "/api/expenses?pageSize=500");
    check("pageSize above 100 -> 400", badPageSize.status === 400, badPageSize.json);

    const badJson = await fetch(`${BASE_URL}/api/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ADMIN_COOKIE },
      body: "{not json",
    });
    check("malformed JSON -> 400", badJson.status === 400, await badJson.text());

    // Whole-Toman amounts stay exact even at multi-billion scale (BigInt in
    // the DB, JSON number on the wire and nowhere near 2^53).
    const big = await api("POST", "/api/expenses", {
      projectId: P.saadatabad,
      userId: reza,
      category: "MATERIALS",
      amount: 9_500_000_000,
      expenseDate: new Date().toISOString(),
    });
    check("multi-billion amount -> 201", big.status === 201, big.json);
    check("large amount round-trips exactly", big.json?.amount === 9_500_000_000, big.json?.amount);

    // WITHOUT a session: the write endpoints refuse.
    const noSessionPost = await fetch(`${BASE_URL}/api/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: P.saadatabad,
        userId: reza,
        category: "MATERIALS",
        amount: 1000,
        expenseDate: new Date().toISOString(),
      }),
    });
    check("POST /api/expenses without a session -> 401", noSessionPost.status === 401, noSessionPost.status);

    const noSessionDelete = await fetch(
      `${BASE_URL}/api/expenses/${createdExpenseId}?requestingUserId=${admin}`,
      { method: "DELETE" },
    );
    check("DELETE without a session -> 401", noSessionDelete.status === 401, noSessionDelete.status);

    const noSessionUpload = await fetch(
      `${BASE_URL}/api/expenses/${createdExpenseId}/invoice`,
      {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "inv.png");
          return form;
        })(),
      },
    );
    check("invoice upload without a session -> 401", noSessionUpload.status === 401, noSessionUpload.status);
  }

  // ------------------------------------------------------------------ list
  section("List and filter");
  {
    const all = await api("GET", "/api/expenses");
    check("GET /api/expenses -> 200", all.status === 200, all.json);
    check("returns a paginated envelope", Array.isArray(all.json?.items) && typeof all.json?.total === "number", Object.keys(all.json ?? {}));
    check("default pageSize is 20", all.json?.pageSize === 20, all.json?.pageSize);
    check("amounts are JSON numbers", all.json?.items?.every((e: any) => typeof e.amount === "number"), all.json?.items?.[0]);

    const byProject = await api(`GET`, `/api/expenses?projectId=${P.saadatabad}`);
    check(
      "filter by projectId",
      byProject.json?.items?.length > 0 && byProject.json.items.every((e: any) => e.projectId === P.saadatabad),
      byProject.json?.items?.map((e: any) => e.projectId),
    );

    const byCategory = await api("GET", "/api/expenses?category=MATERIALS");
    check(
      "filter by category key",
      byCategory.json?.items?.length > 0 && byCategory.json.items.every((e: any) => e.category === "MATERIALS"),
      byCategory.json?.items?.map((e: any) => e.category),
    );

    const byPersian = await api(
      "GET",
      `/api/expenses?category=${encodeURIComponent("مصالح")}`,
    );
    check(
      "filter by Persian category label",
      byPersian.json?.items?.length === byCategory.json?.items?.length,
      { fa: byPersian.json?.items?.length, en: byCategory.json?.items?.length },
    );

    const badCategory = await api("GET", "/api/expenses?category=nonsense");
    check("unknown category filter -> 400", badCategory.status === 400, badCategory.json);

    const byUser = await api(`GET`, `/api/expenses?userId=${ali}`);
    check(
      "filter by userId",
      byUser.json?.items?.length > 0 && byUser.json.items.every((e: any) => e.userId === ali),
      byUser.json?.items?.map((e: any) => e.userId),
    );

    const todayStr = new Date().toISOString().slice(0, 10);
    const byDate = await api(
      "GET",
      `/api/expenses?projectId=${P.saadatabad}&dateFrom=${todayStr}&dateTo=${todayStr}`,
    );
    check(
      "filter by date range (today)",
      byDate.json?.items?.length > 0,
      byDate.json,
    );

    const paged = await api("GET", "/api/expenses?page=1&pageSize=1");
    check("pageSize=1 returns a single item", paged.json?.items?.length === 1, paged.json?.items?.length);
    check("total reflects all matches", paged.json?.total >= 1, paged.json?.total);
    check("totalPages is computed", paged.json?.totalPages === paged.json?.total, paged.json);

    const page2 = await api("GET", "/api/expenses?page=2&pageSize=1");
    check("page 2 returns a different item", page2.json?.items?.[0]?.id !== paged.json?.items?.[0]?.id, {
      p1: paged.json?.items?.[0]?.id, p2: page2.json?.items?.[0]?.id,
    });
  }

  // ------------------------------------------------------------------- one
  section("Get single expense");
  {
    const one = await api("GET", `/api/expenses/${createdExpenseId}`);
    check("GET /api/expenses/:id -> 200", one.status === 200, one.json);
    check("includes project relation", one.json?.project?.name === "سعادت‌آباد" || one.json?.projectName === "سعادت‌آباد", one.json);
    check("includes user relation", !!one.json?.userName, one.json);

    const missing = await api("GET", "/api/expenses/does-not-exist");
    check("unknown id -> 404", missing.status === 404, missing.json);
  }

  // --------------------------------------------------------------- summary
  section("Summary");
  {
    const s = await api("GET", `/api/expenses/summary?projectId=${P.saadatabad}`);
    check("GET /api/expenses/summary -> 200", s.status === 200, s.json);
    check("has today / thisWeek / thisMonth", ["today", "thisWeek", "thisMonth"].every((k) => k in (s.json ?? {})), Object.keys(s.json ?? {}));
    check("totals are numbers", [s.json?.today, s.json?.thisWeek, s.json?.thisMonth].every((t: any) => typeof t?.total === "number"), s.json);
    check("today is included in thisWeek", s.json?.thisWeek?.total >= s.json?.today?.total, s.json);
    check("thisWeek is included in thisMonth", s.json?.thisMonth?.total >= s.json?.thisWeek?.total, s.json);
    check("today has an expense", s.json?.today?.count >= 1, s.json?.today);

    const missingProject = await api("GET", "/api/expenses/summary?projectId=nope");
    check("unknown project -> 404", missingProject.status === 404, missingProject.json);

    const noParam = await api("GET", "/api/expenses/summary");
    check("missing projectId -> 200 (all projects)", noParam.status === 200, noParam.json);
    check("projectId is null when omitted", noParam.json?.projectId === null, noParam.json?.projectId);
    check(
      "all-projects totals >= single-project totals",
      ["today", "thisWeek", "thisMonth"].every(
        (k: string) => noParam.json?.[k]?.total >= s.json?.[k]?.total &&
          noParam.json?.[k]?.count >= s.json?.[k]?.count,
      ),
      { all: noParam.json, one: s.json },
    );
  }

  // ---------------------------------------------------------------- upload
  section("Invoice upload");
  {
    const form = new FormData();
    form.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "inv.png");
    const up = await api("POST", `/api/expenses/${createdExpenseId}/invoice`, form);
    check("POST invoice -> 200", up.status === 200, up.json);
    check("invoiceFilePath is set", typeof up.json?.invoiceFilePath === "string", up.json);
    check("invoiceUrl is exposed", typeof up.json?.invoiceUrl === "string", up.json);
    uploadedName = up.json?.invoiceFilePath ?? null;

    const served = await fetch(`${BASE_URL}/api/invoices/${encodeURIComponent(uploadedName ?? "")}`);
    check("GET /api/invoices/:filename -> 200", served.status === 200, served.status);
    check("content-type is image/png", served.headers.get("content-type") === "image/png", served.headers.get("content-type"));
    const bytes = Buffer.from(await served.arrayBuffer());
    check("bytes round-trip unchanged", bytes.equals(PNG_BYTES), { got: bytes.length, want: PNG_BYTES.length });

    const textForm = new FormData();
    textForm.append("file", new Blob([Buffer.from("hello")], { type: "text/plain" }), "x.txt");
    const badType = await api("POST", `/api/expenses/${createdExpenseId}/invoice`, textForm);
    check("non-image type -> 400", badType.status === 400, badType.json);

    const bigForm = new FormData();
    bigForm.append("file", new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }), "big.png");
    const tooBig = await api("POST", `/api/expenses/${createdExpenseId}/invoice`, bigForm);
    check("file over 5MB -> 400", tooBig.status === 400, tooBig.json);

    const noFile = new FormData();
    const empty = await api("POST", `/api/expenses/${createdExpenseId}/invoice`, noFile);
    check("missing file field -> 400", empty.status === 400, empty.json);

    const traversal = await api("GET", "/api/invoices/..%2F..%2F.env");
    check("path traversal is rejected", traversal.status === 400 || traversal.status === 404, traversal.status);
  }

  // ---------------------------------------------------------------- delete
  section("Soft delete");
  {
    // A dedicated expense, so this section does not depend on earlier ones.
    const fresh = await api("POST", "/api/expenses", {
      projectId: P.pasdaran,
      userId: reza,
      category: "OTHER",
      amount: 42_000,
      expenseDate: new Date().toISOString(),
    });
    const targetId = fresh.json?.id as string;
    check("created a dedicated expense -> 201", fresh.status === 201, fresh.json);

    // The dedicated expense was just created "today", so the all-projects
    // today total must move by exactly its amount once it is soft-deleted.
    const summaryBefore = await api("GET", "/api/expenses/summary");
    const totalBefore = Number(summaryBefore.json?.today?.total ?? 0);

    const noUser = await api("DELETE", `/api/expenses/${targetId}`);
    check("delete without requestingUserId -> 400", noUser.status === 400, noUser.json);

    const asEmployee = await api("DELETE", `/api/expenses/${targetId}?requestingUserId=${reza}`);
    check("employee delete -> 403", asEmployee.status === 403, asEmployee.json);

    // The same check via a JSON body instead of the query string.
    const asEmployeeBody = await api("DELETE", `/api/expenses/${targetId}`, {
      requestingUserId: ali,
    });
    check("employee delete via body -> 403", asEmployeeBody.status === 403, asEmployeeBody.json);

    const asAdmin = await api("DELETE", `/api/expenses/${targetId}?requestingUserId=${admin}`);
    check("admin delete -> 200", asAdmin.status === 200, asAdmin.json);
    check("sets deletedAt", typeof asAdmin.json?.deletedAt === "string", asAdmin.json);

    const gone = await api("GET", `/api/expenses/${targetId}`);
    check("deleted expense -> 404", gone.status === 404, gone.json);

    const list = await api("GET", `/api/expenses?projectId=${P.pasdaran}`);
    check(
      "deleted expense is hidden from the list",
      !list.json?.items?.some((e: any) => e.id === targetId),
      list.json?.items?.map((e: any) => e.id),
    );

    const stillInDb = await prisma.expense.findUnique({ where: { id: targetId } });
    check("row is kept in the database (soft delete)", !!stillInDb?.deletedAt, stillInDb?.deletedAt);

    const summaryAfter = await api("GET", "/api/expenses/summary");
    const totalAfter = Number(summaryAfter.json?.today?.total ?? 0);
    check(
      "soft-deleted expense leaves the summary today-total",
      totalAfter === totalBefore - 42_000,
      { before: totalBefore, after: totalAfter },
    );

    const exportCleaned = await exportFetch(`?projectId=${P.pasdaran}&dateFrom=2026-01-01&dateTo=2026-12-31`);
    const expList = await api("GET", `/api/expenses?projectId=${P.pasdaran}&dateFrom=2026-01-01&dateTo=2026-12-31&pageSize=100`);
    const cleanedWb = new ExcelJS.Workbook();
    await loadXlsx(cleanedWb, exportCleaned.buffer);
    check(
      "soft-deleted expense is hidden from the export",
      (cleanedWb.worksheets[0]?.actualRowCount ?? 1) - 1 === (expList.json?.total ?? -1),
      { rows: cleanedWb.worksheets[0]?.actualRowCount, total: expList.json?.total },
    );
  }

  // ------------------------------------------------------------ excel export
  section("Excel export");
  {
    const anonymous = await fetch(`${BASE_URL}/api/expenses/export`);
    check("export without cookie -> 401", anonymous.status === 401, anonymous.status);

    const forged = await fetch(`${BASE_URL}/api/expenses/export`, {
      headers: { Cookie: "hazineyar_admin=forged" },
    });
    check("export with forged cookie -> 401", forged.status === 401, forged.status);

    // A full-year window so every soft-live row matches the list endpoint,
    // whose total is the source of truth for the export row count.
    const window = "dateFrom=2026-01-01&dateTo=2026-12-31";
    const all = await exportFetch(`?${window}`);
    check("all-projects export -> 200", all.status === 200, all.status);
    check(
      "content-type is xlsx",
      all.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      all.contentType,
    );
    check("disposition downloads a .xlsx", all.disposition.startsWith("attachment") && all.disposition.includes(".xlsx"), all.disposition);

    const listAll = await api("GET", `/api/expenses?${window}&pageSize=100`);
    const expectedTotal = listAll.json?.total ?? -1;

    const wb = new ExcelJS.Workbook();
    await loadXlsx(wb, all.buffer);
    const ws = wb.worksheets[0];
    check("workbook contains a worksheet", !!ws, wb.worksheets.length);

    const allRows = ws ? ws.actualRowCount - 1 : -1;
    check("all-projects row count == list total", allRows === expectedTotal, { rows: allRows, total: expectedTotal });
    check("sheet name is همه پروژه‌ها", ws?.name === "همه پروژه‌ها", ws?.name);
    check("header row is frozen", ws?.views?.[0]?.state === "frozen", ws?.views?.[0]);
    check("sheet is right-to-left", ws?.views?.[0]?.rightToLeft === true, ws?.views?.[0]);

    const header = ws?.getRow(1);
    check("header is bold", header?.getCell(1)?.font?.bold === true, header?.getCell(1)?.font);

    const first = ws?.getRow(2);
    const amountCell = first?.getCell(5);
    check(
      "amount is a number formatted with thousands separator",
      typeof amountCell?.value === "number" && amountCell?.numFmt === "#,##0",
      { value: amountCell?.value, fmt: amountCell?.numFmt },
    );
    check("date cell is Jalali", /^\d{4}\/\d{2}\/\d{2}$/.test(String(first?.getCell(1)?.value ?? "")), first?.getCell(1)?.value);
    check("invoice cell is text", /^invoice_\d{3}$/.test(String(first?.getCell(6)?.value ?? "")), first?.getCell(6)?.value);

    // Single project: the sheet is named after it and rows still match.
    const one = await exportFetch(`?projectId=${P.saadatabad}&${window}`);
    check("single-project export -> 200", one.status === 200, one.status);
    const wbOne = new ExcelJS.Workbook();
    await loadXlsx(wbOne, one.buffer);
    check("single-project sheet is the project name", wbOne.worksheets[0]?.name === "سعادت‌آباد", wbOne.worksheets[0]?.name);
    const listOne = await api("GET", `/api/expenses?projectId=${P.saadatabad}&${window}&pageSize=100`);
    check(
      "single-project rows match list",
      (wbOne.worksheets[0]?.actualRowCount ?? 1) - 1 === (listOne.json?.total ?? -1),
      { rows: wbOne.worksheets[0]?.actualRowCount, total: listOne.json?.total },
    );

    // Every category: the exported rows equal the list total for the same URL.
    for (const cat of ["MATERIALS", "WORKER_FOOD", "TRANSPORT", "WAGES", "TOOLS", "OTHER"]) {
      const query = `?${window}&category=${cat}`;
      const catResp = await exportFetch(query);
      const catList = await api("GET", `/api/expenses${query}&pageSize=100`);
      const catWb = new ExcelJS.Workbook();
      await loadXlsx(catWb, catResp.buffer);
      check(
        `category ${cat} export rows match`,
        catResp.status === 200 && (catWb.worksheets[0]?.actualRowCount ?? 1) - 1 === (catList.json?.total ?? -1),
        { status: catResp.status, rows: catWb.worksheets[0]?.actualRowCount, total: catList.json?.total },
      );
    }

    const bad = await exportFetch("?dateFrom=2026-01-01&dateTo=2026-01-00");
    check("malformed date -> 400", bad.status === 400, bad.status);

    // A window that matches nothing: still 200, with just the header row.
    const empty = await exportFetch("?dateFrom=2000-01-01&dateTo=2000-01-02");
    check("empty-window export -> 200", empty.status === 200, empty.status);
    const emptyWb = new ExcelJS.Workbook();
    await loadXlsx(emptyWb, empty.buffer);
    check("empty export has zero data rows", (emptyWb.worksheets[0]?.actualRowCount ?? 1) - 1 === 0, emptyWb.worksheets[0]?.actualRowCount);
  }

  // -------------------------------------------------------- jalali boundary
  section("Jalali date conversions");
  {
    // Two-facing round-trips across the Esfand/Farvardin and the year boundary.
    // `expenseDate` is a calendar date stored as UTC midnight, so the round-trip
    // goes Jalali -> UTC-midnight Gregorian -> Jalali (the production path).
    const travel = (y: number, m: number, d: number) => {
      const g = toGregorian(y, m, d);
      const utc = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
      return (
        formatJalaliUtc(utc) ===
        `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`
      );
    };

    check("round-trip 1404/12/29 (end of Esfand)", travel(1404, 12, 29));
    check("round-trip 1405/01/01 (Farvardin 1)", travel(1405, 1, 1));
    check("round-trip 1405/12/29 (end of Esfand 1405)", travel(1405, 12, 29));
    check("round-trip 1406/01/01 (Farvardin 1 again)", travel(1406, 1, 1));
    check("round-trip 1405/06/31 (long month)", travel(1405, 6, 31));
    check("round-trip 1408/12/30 (30-day Esfand, leap year)", travel(1408, 12, 30));

    // New Year's Eve is exactly one day before Farvardin 1 in UTC-midnight terms.
    const prevDay = (y: number, m: number, d: number) =>
      new Date(Date.UTC(toGregorian(y, m, d).gy, toGregorian(y, m, d).gm - 1, toGregorian(y, m, d).gd));
    const esfandLast = prevDay(1405, 12, 29);
    const farvardin1 = prevDay(1406, 1, 1);
    check(
      "Farvardin 1 follows the last day of Esfand by exactly one day",
      farvardin1.getTime() - esfandLast.getTime() === 24 * 60 * 60 * 1000,
      { esfandLast: formatJalaliUtc(esfandLast), farvardin1: formatJalaliUtc(farvardin1) },
    );

    // A Gregorian date known to sit just across the boundary formats as Farvardin.
    const nowruz = formatJalaliUtc(new Date(Date.UTC(2026, 2, 22)));
    check("2026-03-22 formats as 1405/01/.. ", /^1405\/01\/\d{2}$/.test(nowruz), nowruz);
  }

  // ----------------------------------------------------------------- done
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\nTest run failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
