/**
 * End-to-end check for the dashboard's staff management: the /api/admin routes
 * the owner UI calls, and the Telegram flow that depends on what they set up.
 *
 * The last section is the flow the product promises: a project and an employee
 * are created through the API exactly as the admin page posts them, the new
 * employee logs an expense to the new project, and the two deactivation
 * guarantees are checked against the real bot.
 *
 * Requires the dev server (npm run dev) and a seeded database.
 */
import "./test-env";

import { createHmac } from "node:crypto";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createBot } from "../src/adapters/telegram/bot";
import { approveAccessRequest } from "../src/core/access/service";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) {
      console.log(`        ${JSON.stringify(detail).slice(0, 400)}`);
    }
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, Object.is(actual, expected), { actual, expected });
}

/** Length of an array that might be undefined coming from the wire. */
function unsafeLen(value: unknown): number {
  return Array.isArray(value) ? value.length : -1;
}

/** True when a wire string carries Persian letters (an error meant for a human). */
function isPersianMessage(value: unknown): boolean {
  return typeof value === "string" && /[\u0600-\u06ff]/.test(value);
}

/**
 * The filter bar's project <select name="project"> only. Each expense row's edit
 * form renders a separate <select name="projectId"> that always carries the
 * row's own project — even an inactive one, so that saving an edit cannot
 * silently reassign the expense. A whole-page search for the project id thus
 * says nothing about the filter toggle, so this narrows the check to the filter.
 */
function projectFilterHtml(html: string): string {
  const start = html.indexOf('<select name="project"');
  if (start < 0) return "";
  const end = html.indexOf("</select>", start);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/** The same HMAC token lib/auth.ts derives from ADMIN_PASSWORD. */
const ADMIN_COOKIE = `hazineyar_admin=${createHmac(
  "sha256",
  process.env.ADMIN_PASSWORD ?? "admin123",
)
  .update("hazineyar.dashboard.v1")
  .digest("hex")}`;

type Json = Record<string, any> | null;

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  { auth = true }: { auth?: boolean } = {},
): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { cookie: ADMIN_COOKIE } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

/** A run-scoped name, so a repeat run never collides with an active project. */
const RUN = String(Date.now()).slice(-6);
const projectName = (suffix: string) => `پروژه آزمون ${RUN}-${suffix}`;

/** A Telegram id the bot can act as; prefixed so cleanup can find it. */
const NEW_EMPLOYEE_TG = `888000${RUN}`;
const SECOND_EMPLOYEE_TG = `888111${RUN}`;
/** A third id for the end-to-end flow, so that one is a genuinely new account. */
const FRESH_EMPLOYEE_TG = `888222${RUN}`;
/** An access-request user, plus a user the admin then rejects. */
const REQUEST_TG = `888333${RUN}`;
const REJECT_TG = `888444${RUN}`;
/** A request whose display name is hostile, to pin down HTML escaping. */
const HOSTILE_TG = `888555${RUN}`;
/** Fixtures for naming on approval, renaming, and the pending badge. */
const NAME_TG = `888777${RUN}`;
const DUP_TG = `888778${RUN}`;
const RENAME_TG = `888779${RUN}`;
const RENAME_USER_TG = `888771${RUN}`;
const BADGE_TG = `888770${RUN}`;
/** The user driving a group deep-link flow against the live settings API. */
const MODERATOR_TG = `888666${RUN}`;
/** A group linked for the announcement flow. */
const GROUP_CHAT = -10000000000 - Number(RUN);

const createdProjects: string[] = [];
const createdUsers: string[] = [];

async function main() {
  console.log("admin management\n");

  // A crashed run can leave fixtures behind; the bot resolves users by this id,
  // so a stale one would shadow the user this run creates.
  await prisma.user.deleteMany({ where: { externalId: { startsWith: "888" } } });

  let projectId = "";
  let userId = "";
  let secondUserId = "";

  // ------------------------------------------------------------- 401 gates
  section("Unauthenticated admin routes");
  {
    const unauth = [
      ["GET", "/api/admin/projects"],
      ["POST", "/api/admin/projects"],
      ["GET", "/api/admin/users"],
      ["POST", "/api/admin/users"],
      ["GET", "/api/admin/settings"],
      ["POST", "/api/admin/settings"],
    ] as const;
    for (const [method, path] of unauth) {
      const { status } = await call(method, path, method === "POST" ? {} : undefined, {
        auth: false,
      });
      check(`${method} ${path} without a session -> 401`, status === 401, status);
    }

    // The id routes need a real id only to reach the auth check, so a dummy
    // path proves the gate runs before any lookup.
    const guarded = [
      ["POST", "/api/admin/projects/some-id/status"],
      ["POST", "/api/admin/users/some-id/status"],
      ["POST", "/api/admin/users/some-id/projects"],
      ["POST", "/api/admin/users/some-id/name"],
      ["POST", "/api/admin/access-requests/some-id/approve"],
      ["POST", "/api/admin/access-requests/some-id/reject"],
    ] as const;
    for (const [method, path] of guarded) {
      const { status } = await call(method, path, { isActive: false, projectIds: [], role: "EMPLOYEE" }, { auth: false });
      check(`${method} ${path} without a session -> 401`, status === 401, status);
    }
  }

  // ------------------------------------------------------------- projects
  section("Project management");
  {
    const created = await call("POST", "/api/admin/projects", { name: projectName("a") });
    check("create project -> 201", created.status === 201, created.json);
    projectId = created.json?.project?.id ?? "";
    check("returns the new project id", !!projectId, created.json);
    check("starts active", created.json?.project?.isActive === true, created.json);
    createdProjects.push(projectId);

    const duplicate = await call("POST", "/api/admin/projects", { name: projectName("a") });
    check("duplicate active name -> 400", duplicate.status === 400, duplicate.json);
    check(
      "duplicate is explained in Persian",
      typeof duplicate.json?.error?.message === "string" &&
        duplicate.json.error.message.includes("پروژه"),
      duplicate.json,
    );

    const tooShort = await call("POST", "/api/admin/projects", { name: "  " });
    check("blank name -> 400", tooShort.status === 400, tooShort.json);
    const tooLong = await call("POST", "/api/admin/projects", { name: "پ".repeat(81) });
    check("over-long name -> 400", tooLong.status === 400, tooLong.json);

    const listed = await call("GET", "/api/admin/projects");
    check("list -> 200", listed.status === 200, listed.status);
    check(
      "the new project is listed",
      listed.json?.projects?.some((p: Json) => p?.id === projectId),
    );
    check(
      "each project carries its expense count",
      listed.json?.projects?.every(
        (p: Json) => typeof p?.expenseCount === "number",
      ),
      listed.json?.projects?.[0],
    );

    const off = await call("POST", `/api/admin/projects/${projectId}/status`, { isActive: false });
    check("deactivate -> 200", off.status === 200, off.json);
    check("reports isActive false", off.json?.project?.isActive === false, off.json);

    // A deactivated name is free again, which is how a finished site and its
    // successor can share a name.
    const reused = await call("POST", "/api/admin/projects", { name: projectName("a") });
    check("name reusable once deactivated -> 201", reused.status === 201, reused.json);
    createdProjects.push(reused.json?.project?.id ?? "");

    const on = await call("POST", `/api/admin/projects/${projectId}/status`, { isActive: true });
    check("reactivate -> 200", on.status === 200, on.json);
    check("reports isActive true", on.json?.project?.isActive === true, on.json);

    const missing = await call("POST", "/api/admin/projects/does-not-exist/status", {
      isActive: false,
    });
    check("unknown project -> 404", missing.status === 404, missing.json);
  }

  // --------------------------------------------------------------- users
  section("User management");
  {
    const other = await call("POST", "/api/admin/projects", { name: projectName("b") });
    createdProjects.push(other.json?.project?.id ?? "");

    const created = await call("POST", "/api/admin/users", {
      name: "کارمند تازه",
      externalId: NEW_EMPLOYEE_TG,
      role: "EMPLOYEE",
      projectIds: [projectId],
    });
    check("create user -> 201", created.status === 201, created.json);
    userId = created.json?.user?.id ?? "";
    check("returns the new user id", !!userId, created.json);
    check(
      "linked to the chosen project",
      created.json?.user?.projects?.some((p: Json) => p?.id === projectId),
      created.json?.user,
    );
    check(
      "defaults to the telegram channel",
      created.json?.user?.channel === "telegram",
      created.json?.user,
    );
    check("role is readable in Persian", created.json?.user?.roleLabel === "کارمند", created.json?.user);
    createdUsers.push(userId);

    const duplicate = await call("POST", "/api/admin/users", {
      name: "همان شناسه",
      externalId: NEW_EMPLOYEE_TG,
    });
    check("duplicate externalId -> 400", duplicate.status === 400, duplicate.json);
    check(
      "duplicate is explained in Persian",
      typeof duplicate.json?.error?.message === "string" &&
        duplicate.json.error.message.includes("از قبل ثبت شده"),
      duplicate.json,
    );
    check(
      "the duplicate did not create a second row",
      (await prisma.user.count({ where: { externalId: NEW_EMPLOYEE_TG } })) === 1,
    );

    const notNumeric = await call("POST", "/api/admin/users", {
      name: "نامعتبر",
      externalId: "reza001",
    });
    check("non-numeric externalId -> 400", notNumeric.status === 400, notNumeric.json);

    const blank = await call("POST", "/api/admin/users", { name: " ", externalId: SECOND_EMPLOYEE_TG });
    check("blank name -> 400", blank.status === 400, blank.json);

    const unknownProject = await call("POST", "/api/admin/users", {
      name: "پروژه ناموجود",
      externalId: SECOND_EMPLOYEE_TG,
      projectIds: ["does-not-exist"],
    });
    check("unknown projectId -> 400", unknownProject.status === 400, unknownProject.json);

    const admin = await call("POST", "/api/admin/users", {
      name: "ادمین تازه",
      externalId: SECOND_EMPLOYEE_TG,
      role: "ADMIN",
    });
    check("create an admin -> 201", admin.status === 201, admin.json);
    check("role is admin", admin.json?.user?.role === "ADMIN", admin.json?.user);
    secondUserId = admin.json?.user?.id ?? "";
    createdUsers.push(secondUserId);

    const listed = await call("GET", "/api/admin/users");
    check("list users -> 200", listed.status === 200, listed.status);
    check(
      "the new user is listed with access",
      listed.json?.users?.some(
        (u: Json) => u?.id === userId && u?.projects?.length === 1,
      ),
      listed.json?.users?.[0],
    );

    const unknownUser = await call("POST", "/api/admin/users/does-not-exist/status", {
      isActive: false,
    });
    check("unknown user -> 404", unknownUser.status === 404, unknownUser.json);
  }

  // ------------------------------------------------------------ access list
  section("Project access");
  {
    const second = createdProjects.find((id) => id && id !== projectId) ?? "";

    const replaced = await call("POST", `/api/admin/users/${userId}/projects`, {
      projectIds: [second],
    });
    check("replace the access list -> 200", replaced.status === 200, replaced.json);
    check(
      "only the new project is linked",
      replaced.json?.user?.projects?.length === 1 &&
        replaced.json.user.projects[0]?.id === second,
      replaced.json?.user,
    );
    check(
      "the database agrees",
      (await prisma.userProject.count({ where: { userId } })) === 1,
    );

    const revoked = await call("POST", `/api/admin/users/${userId}/projects`, { projectIds: [] });
    check("revoke every project -> 200", revoked.status === 200, revoked.json);
    check(
      "no links remain",
      revoked.json?.user?.projects?.length === 0 &&
        (await prisma.userProject.count({ where: { userId } })) === 0,
      revoked.json?.user,
    );

    const duplicates = await call("POST", `/api/admin/users/${userId}/projects`, {
      projectIds: [projectId, projectId],
    });
    check("duplicate ids collapse -> 200", duplicates.status === 200, duplicates.json);
    check(
      "stored once",
      (await prisma.userProject.count({ where: { userId, projectId } })) === 1,
    );

    const unknown = await call("POST", `/api/admin/users/${userId}/projects`, {
      projectIds: ["does-not-exist"],
    });
    check("unknown project in the list -> 400", unknown.status === 400, unknown.json);
    check(
      "the previous list is left intact",
      (await prisma.userProject.count({ where: { userId } })) === 1,
    );
  }

  // ------------------------------------------------------ access requests
  section("Access requests");
  {
    const sent: Sent[] = [];
    const bot = createBot("test:token", { client: { fetch: stubFetch(sent) } });
    await bot.init();
    const send = (update: unknown) => bot.handleUpdate(update as never);

    // The unknown user messages the real bot: a pending row appears.
    sent.length = 0;
    await send(message("/expense", REQUEST_TG));
    check(
      "the bot asks for the manager's approval",
      texts(sent).some((t) => t.includes("درخواست دسترسی")),
      texts(sent),
    );
    sent.length = 0;
    await send(message("/start", REQUEST_TG));
    eq(
      "a repeat message refreshes the same row",
      await prisma.accessRequest.count({ where: { externalId: REQUEST_TG } }),
      1,
    );

    const request = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "telegram", externalId: REQUEST_TG } },
    });
    check("the row is pending", request?.status === "PENDING", request);

    // The owner's page lists it, and hostile display names stay HTML-escaped.
    await prisma.accessRequest.create({
      data: { channel: "telegram", externalId: HOSTILE_TG, displayName: "<script>alert(1)</script>" },
    });
    const adminPage = await fetch(`${BASE_URL}/dashboard/admin`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    const adminHtml = await adminPage.text();
    check("the admin page renders", adminPage.status === 200, adminPage.status);
    check(
      "it has the access-request panel",
      adminHtml.includes("درخواست‌های دسترسی"),
      "",
    );
    check(
      "it posts the approve form for the pending request",
      adminHtml.includes(`/api/admin/access-requests/${request!.id}/approve`),
      "",
    );
    check(
      "a hostile display name is not injected raw",
      !adminHtml.includes("<script>alert(1)</script>"),
      "",
    );
    check(
      "it is HTML-escaped instead",
      adminHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      adminHtml.slice(adminHtml.indexOf("&lt;script&gt;") - 40, adminHtml.indexOf("&lt;script&gt;") + 60),
    );

    // Approving it builds the account, exactly like the manual form.
    const approved = await call("POST", `/api/admin/access-requests/${request!.id}/approve`, {
      role: "EMPLOYEE",
      projectIds: [projectId],
    });
    check("approve -> 200", approved.status === 200, approved.json);
    const approvedUserId = approved.json?.user?.id ?? "";
    createdUsers.push(approvedUserId);
    check("the account is created", !!approvedUserId, approved.json);
    check(
      "linked to the chosen project",
      approved.json?.user?.projects?.some((p: Json) => p?.id === projectId),
      approved.json?.user,
    );
    check(
      "the notification outcome is reported",
      typeof approved.json?.notified === "boolean",
      approved.json,
    );
    eq(
      "the request is now APPROVED",
      (await prisma.accessRequest.findUnique({ where: { id: request!.id } }))?.status,
      "APPROVED",
    );

    // The approved user can now log an expense through the real bot.
    const projectNameRow = await prisma.project.findUnique({ where: { id: projectId } });
    const pname = projectNameRow?.name ?? "";
    sent.length = 0;
    await send(message("/expense", REQUEST_TG));
    check("their project is offered", labels(sent).includes(pname), labels(sent));
    await send(click(dataFor(sent, pname)!, REQUEST_TG));
    await send(click(dataFor(sent, "سایر")!, REQUEST_TG));
    await send(message("900000", REQUEST_TG));
    await send(message("هزینه از طریق درخواست دسترسی", REQUEST_TG));
    await send(click("invoice:skip", REQUEST_TG));
    await send(click(dataFor(sent, "تأیید")!, REQUEST_TG));
    check(
      "the approved user records an expense",
      (await prisma.expense.count({ where: { userId: approvedUserId, amount: 900_000n } })) === 1,
    );

    // Rejecting another request is sticky through the bot.
    const rejectedRequest = await prisma.accessRequest.create({
      data: { channel: "telegram", externalId: REJECT_TG, displayName: "رد شونده" },
    });
    const rejected = await call("POST", `/api/admin/access-requests/${rejectedRequest.id}/reject`);
    check("reject -> 200", rejected.status === 200, rejected.json);
    check("reports REJECTED", rejected.json?.request?.status === "REJECTED", rejected.json);
    sent.length = 0;
    await send(message("/expense", REJECT_TG));
    check(
      "the bot refuses the rejected user",
      texts(sent).some((t) => t.includes("تایید نشده")),
      texts(sent),
    );

    // The edge cases: already-approved and never-existing requests.
    const double = await call("POST", `/api/admin/access-requests/${request!.id}/approve`, {
      role: "EMPLOYEE",
      projectIds: [projectId],
    });
    check("double approval -> 400", double.status === 400, double.json);
    const unknown = await call("POST", "/api/admin/access-requests/does-not-exist/approve", {
      role: "EMPLOYEE",
      projectIds: [],
    });
    check("unknown request -> 404", unknown.status === 404, unknown.json);
  }

  // ------------------------------------------------ naming on approval
  section("Manager chooses the approved user's name");
  {
    // (a) The name the manager types is the name the account gets.
    await prisma.accessRequest.deleteMany({ where: { externalId: NAME_TG } });
    await prisma.accessRequest.create({
      data: {
        channel: "telegram",
        externalId: NAME_TG,
        displayName: "نام روی تلگرام",
        username: "tg_name",
      },
    });
    const request = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "telegram", externalId: NAME_TG } },
    });
    const approved = await call("POST", `/api/admin/access-requests/${request!.id}/approve`, {
      name: "سعید محمدی",
      role: "EMPLOYEE",
      projectIds: [projectId],
    });
    check("approve with a manager-typed name -> 200", approved.status === 200, approved.json);
    const namedUserId = approved.json?.user?.id ?? "";
    createdUsers.push(namedUserId);
    check(
      "the account carries the manager's name",
      approved.json?.user?.name === "سعید محمدی",
      approved.json?.user,
    );
    check(
      "and not the Telegram display name",
      approved.json?.user?.name !== "نام روی تلگرام",
      approved.json?.user,
    );
    check(
      "the database keeps the chosen name",
      (await prisma.user.findUnique({ where: { id: namedUserId } }))?.name === "سعید محمدی",
    );

    // (b) The greeting is sent by the chosen name (captured with a stub notifier
    // so no real Telegram call happens).
    await prisma.accessRequest.create({
      data: { channel: "telegram", externalId: DUP_TG, displayName: "تلگرام دوم" },
    });
    const request2 = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "telegram", externalId: DUP_TG } },
    });
    const greeted: string[] = [];
    const outcome = await approveAccessRequest(
      { id: request2!.id, name: "نام دلخواه مدیر", role: "EMPLOYEE", projectIds: [] },
      {
        notifyUser: async (_externalId, text) => {
          greeted.push(text);
        },
      },
    );
    createdUsers.push(outcome.user.id);
    check(
      "the greeting uses the chosen name",
      greeted.some((text) => text.includes("نام دلخواه مدیر")),
      greeted,
    );
    check(
      "the Telegram name is not used in the greeting",
      !greeted.some((text) => text.includes("تلگرام دوم")),
      greeted,
    );

    // (c) Empty and over-long names are refused with a Persian message.
    const invalid = await prisma.accessRequest.create({
      data: { channel: "telegram", externalId: RENAME_TG, displayName: "برای اعتبارسنجی" },
    });
    const blank = await call("POST", `/api/admin/access-requests/${invalid.id}/approve`, {
      name: "   ",
      role: "EMPLOYEE",
      projectIds: [],
    });
    check("a blank name -> 400", blank.status === 400, blank.json);
    check("the blank-name error is Persian", isPersianMessage(blank.json?.error?.message), blank.json);
    const long = await call("POST", `/api/admin/access-requests/${invalid.id}/approve`, {
      name: "ن".repeat(81),
      role: "EMPLOYEE",
      projectIds: [],
    });
    check("an over-long name -> 400", long.status === 400, long.json);
    check("the over-long-name error is Persian", isPersianMessage(long.json?.error?.message), long.json);
    check(
      "no account was created for the invalid approvals",
      (await prisma.user.count({ where: { externalId: RENAME_TG } })) === 0,
    );

    // (d) A clashing name is only a soft warning; the approval still succeeds.
    const dup = await call("POST", `/api/admin/access-requests/${invalid.id}/approve`, {
      name: "سعید محمدی",
      role: "EMPLOYEE",
      projectIds: [],
    });
    check("a duplicate name still approves -> 200", dup.status === 200, dup.json);
    check(
      "a duplicate name returns the soft warning",
      typeof dup.json?.warning === "string" && dup.json.warning.includes("نام"),
      dup.json,
    );
    const dupUserId = dup.json?.user?.id ?? "";
    createdUsers.push(dupUserId);
    check(
      "the duplicate-named account was created",
      (await prisma.user.count({ where: { id: dupUserId } })) === 1,
    );
  }

  // --------------------------------------------------------- renaming users
  section("Renaming an existing user");
  {
    const proj = await call("POST", "/api/admin/projects", { name: `نام‌گذاری ${RUN}` });
    const nameProjectId = proj.json?.project?.id ?? "";
    createdProjects.push(nameProjectId);

    const emp = await call("POST", "/api/admin/users", {
      name: "نام قدیمی",
      externalId: RENAME_USER_TG,
      projectIds: [nameProjectId],
    });
    const renameUserId = emp.json?.user?.id ?? "";
    createdUsers.push(renameUserId);
    check("the rename fixture user exists", !!renameUserId, emp.json);
    const expense = await prisma.expense.create({
      data: {
        projectId: nameProjectId,
        userId: renameUserId,
        category: "MATERIALS",
        amount: 123_000n,
        invoiceNumber: `ren_${RUN}_1`,
        expenseDate: new Date(),
      },
    });

    const noAuth = await call(
      "POST",
      `/api/admin/users/${renameUserId}/name`,
      { name: "هرچه" },
      { auth: false },
    );
    check("rename without a session -> 401", noAuth.status === 401, noAuth.status);

    const blankRename = await call("POST", `/api/admin/users/${renameUserId}/name`, { name: " " });
    check("a blank rename -> 400", blankRename.status === 400, blankRename.json);
    check("the blank-rename error is Persian", isPersianMessage(blankRename.json?.error?.message), blankRename.json);
    const longRename = await call("POST", `/api/admin/users/${renameUserId}/name`, { name: "ن".repeat(81) });
    check("an over-long rename -> 400", longRename.status === 400, longRename.json);
    const controlRename = await call("POST", `/api/admin/users/${renameUserId}/name`, {
      name: "نام\nخبیث",
    });
    check("a control character in the name -> 400", controlRename.status === 400, controlRename.json);

    const renamed = await call("POST", `/api/admin/users/${renameUserId}/name`, { name: "نام تازه" });
    check("rename -> 200", renamed.status === 200, renamed.json);
    check("the API reports the new name", renamed.json?.user?.name === "نام تازه", renamed.json?.user);
    check(
      "the database agrees",
      (await prisma.user.findUnique({ where: { id: renameUserId } }))?.name === "نام تازه",
    );

    // The dashboard expense list reads the name through the user relation.
    const page = await fetch(`${BASE_URL}/dashboard?project=${nameProjectId}`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    const html = await page.text();
    check("the expense list shows the new name", html.includes("نام تازه"));
    check("the old name is gone from the list", !html.includes("نام قدیمی"));

    // The Excel export's ثبت‌کننده column reads the same relation.
    const exported = await fetch(
      `${BASE_URL}/api/expenses/export?projectId=${nameProjectId}`,
      { headers: { cookie: ADMIN_COOKIE } },
    );
    check("the export -> 200", exported.status === 200, exported.status);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(await exported.arrayBuffer()) as unknown as ArrayBuffer,
    );
    const exportedNames: string[] = [];
    workbook.worksheets[0]?.eachRow((row) => {
      exportedNames.push(String(row.getCell(3).value ?? ""));
    });
    check("the export shows the new name", exportedNames.includes("نام تازه"), exportedNames);
    check("the export no longer shows the old name", !exportedNames.includes("نام قدیمی"), exportedNames);

    // The rename is a name change, not a re-attribution.
    check(
      "the historical expense still points at the same user",
      (await prisma.expense.findUnique({ where: { id: expense.id } }))?.userId === renameUserId,
    );

    // A clash with another active user is a soft warning on rename too.
    const dupRename = await call("POST", `/api/admin/users/${renameUserId}/name`, {
      name: "کارمند تازه",
    });
    check("a duplicate rename -> 200", dupRename.status === 200, dupRename.json);
    check(
      "a duplicate rename warns softly",
      typeof dupRename.json?.warning === "string" && dupRename.json.warning.includes("نام"),
      dupRename.json,
    );
  }

  // ---------------------------------------- admin page presentation details
  section("Access requests are the primary path");
  {
    // With an empty queue the page shows the friendly hint, and the manual
    // add-user form is collapsed inside a <details>.
    await prisma.accessRequest.deleteMany({ where: { status: "PENDING" } });
    const emptyPage = await fetch(`${BASE_URL}/dashboard/admin`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    const emptyHtml = await emptyPage.text();
    check("the admin page renders", emptyPage.status === 200, emptyPage.status);
    check(
      "an empty queue shows the friendly hint",
      emptyHtml.includes("از کارمند بخواهید ربات را در پیام خصوصی Start کند"),
    );

    const manualTitle = "افزودن دستی کاربر (پیشرفته)";
    const titleAt = emptyHtml.indexOf(manualTitle);
    check("the manual form is titled as advanced", titleAt >= 0);
    if (titleAt >= 0) {
      const detailsAt = emptyHtml.lastIndexOf("<details", titleAt);
      const openTag =
        detailsAt >= 0
          ? emptyHtml.slice(detailsAt, emptyHtml.indexOf(">", detailsAt) + 1)
          : "";
      check("the manual form is collapsed by default", !/\sopen(=|\s|>)/.test(openTag), openTag);
    }

    // The pending badge is absent at zero and appears the moment one arrives.
    const none = await fetch(`${BASE_URL}/dashboard`, { headers: { cookie: ADMIN_COOKIE } });
    const noneHtml = await none.text();
    check("no badge while nothing is pending", !noneHtml.includes('data-testid="pending-badge"'));

    await prisma.accessRequest.create({
      data: { channel: "telegram", externalId: BADGE_TG, displayName: "برای نشان" },
    });
    const some = await fetch(`${BASE_URL}/dashboard`, { headers: { cookie: ADMIN_COOKIE } });
    const someHtml = await some.text();
    check("the badge appears with a pending request", someHtml.includes('data-testid="pending-badge"'));
    check(
      "the badge carries the count",
      /data-testid="pending-badge"[^>]*>\s*1\s*</.test(someHtml),
      "",
    );
  }

  // ------------------------------------------------------ settings + groups
  section("Group announcement settings");
  {
    const defaults = await call("GET", "/api/admin/settings");
    check("read settings -> 200", defaults.status === 200, defaults.status);
    check(
      "defaults are FULL, invoice attached and direct expenses announced",
      defaults.json?.settings?.announceMode === "FULL" &&
        defaults.json?.settings?.includeInvoice === true &&
        defaults.json?.settings?.announceDirectExpenses === true,
      defaults.json,
    );

    const badMode = await call("POST", "/api/admin/settings", { announceMode: "LOUD", includeInvoice: true });
    check("unknown announceMode -> 400", badMode.status === 400, badMode.json);
    const missing = await call("POST", "/api/admin/settings", { announceMode: "MINIMAL" });
    check("missing includeInvoice -> 400", missing.status === 400, missing.json);

    const saved = await call("POST", "/api/admin/settings", {
      announceMode: "MINIMAL",
      includeInvoice: false,
      announceDirectExpenses: false,
    });
    check("save settings -> 200", saved.status === 200, saved.json);
    check(
      "the value is persisted",
      saved.json?.settings?.announceMode === "MINIMAL" &&
        saved.json?.settings?.includeInvoice === false &&
        saved.json?.settings?.announceDirectExpenses === false,
      saved.json,
    );

    // The bot reads that row back through its own Prisma client, so this proves
    // a dashboard save reaches a running bot without a restart.
    const row = await prisma.setting.findUnique({ where: { key: "announcement" } });
    check(
      "the bot's row is stored on the shared database",
      !!row && (JSON.parse(row.value) as { announceMode?: string })?.announceMode === "MINIMAL",
      row,
    );

    await prisma.linkedChat.upsert({
      where: { channel_externalChatId: { channel: "telegram", externalChatId: String(GROUP_CHAT) } },
      create: { channel: "telegram", externalChatId: String(GROUP_CHAT), title: `گروه آزمون ${RUN}` },
      update: { title: `گروه آزمون ${RUN}` },
    });

    const groupProject = await call("POST", "/api/admin/projects", { name: `گروه سرور ${RUN}` });
    const groupProjectId = groupProject.json?.project?.id ?? "";
    createdProjects.push(groupProjectId);
    const moderator = await call("POST", "/api/admin/users", {
      name: "مدیر آزمون",
      externalId: MODERATOR_TG,
      role: "EMPLOYEE",
      projectIds: [groupProjectId],
    });
    createdUsers.push(moderator.json?.user?.id ?? "");

    const sent: Sent[] = [];
    const bot = createBot("test:token", { client: { fetch: stubFetch(sent) } });
    await bot.init();
    const send = (update: unknown) => bot.handleUpdate(update as never);

    sent.length = 0;
    await send(message(`/start g${Math.abs(GROUP_CHAT)}`, MODERATOR_TG));
    check(
      "the deep link starts the guided flow",
      labels(sent).includes(`گروه سرور ${RUN}`),
      labels(sent),
    );
    await send(click(dataFor(sent, `گروه سرور ${RUN}`)!, MODERATOR_TG));
    await send(click(dataFor(sent, "سایر")!, MODERATOR_TG));
    await send(message("750000", MODERATOR_TG));
    await send(message("اعلام خلاصه", MODERATOR_TG));
    await send(click("invoice:skip", MODERATOR_TG));
    await send(click(dataFor(sent, "تأیید")!, MODERATOR_TG));
    const groupCall = sent.find(
      (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(GROUP_CHAT),
    );
    eq(
      "a MINIMAL announcement is posted to the group",
      String(groupCall?.params?.text ?? ""),
      `✅ ثبت شد: مدیر آزمون | گروه سرور ${RUN}`,
    );
    check(
      "the amount is dropped in MINIMAL",
      !String(groupCall?.params?.text ?? "").includes("750,000"),
    );

    // OFF is honored immediately, through the same settings row.
    await call("POST", "/api/admin/settings", { announceMode: "OFF", includeInvoice: true });
    sent.length = 0;
    await send(message(`/start g${Math.abs(GROUP_CHAT)}`, MODERATOR_TG));
    await send(click(dataFor(sent, `گروه سرور ${RUN}`)!, MODERATOR_TG));
    await send(click(dataFor(sent, "سایر")!, MODERATOR_TG));
    await send(message("760000", MODERATOR_TG));
    await send(click("description:skip", MODERATOR_TG));
    await send(click("invoice:skip", MODERATOR_TG));
    await send(click(dataFor(sent, "تأیید")!, MODERATOR_TG));
    check(
      "nothing is posted while OFF",
      !sent.some((c) => c.method === "sendMessage" && String(c.params.chat_id) === String(GROUP_CHAT)),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    // The dashboard page lets you flip the mode back.
    const restore = await call("POST", "/api/admin/settings", {
      announceMode: "FULL",
      includeInvoice: true,
    });
    check("restore the defaults -> 200", restore.status === 200, restore.json);
  }

  // ------------------------------------------------- the owner's end-to-end
  section("New employee logs an expense through the bot");
  {
    // Exactly what the admin page posts for a brand-new project + employee.
    const site = await call("POST", "/api/admin/projects", { name: `کارگاه ${RUN}` });
    const siteId = site.json?.project?.id ?? "";
    createdProjects.push(siteId);

    const employee = await call("POST", "/api/admin/users", {
      name: "کارمند تازه‌وارد",
      externalId: FRESH_EMPLOYEE_TG,
      projectIds: [siteId],
    });
    const employeeId = employee.json?.user?.id ?? "";
    createdUsers.push(employeeId);
    check("the site and the employee are created", !!siteId && !!employeeId, {
      site: site.json,
      employee: employee.json,
    });

    const sent: Sent[] = [];
    const bot = createBot("test:token", { client: { fetch: stubFetch(sent) } });
    await bot.init();
    sent.length = 0;
    const send = (update: unknown) => bot.handleUpdate(update as never);

    // 1. The employee starts the flow and is offered the assigned project only.
    sent.length = 0;
    await send(message("/expense", FRESH_EMPLOYEE_TG));
    check("the bot greets the new employee", texts(sent).some((t) => t.includes("پروژه")), texts(sent));
    check("their project is offered", labels(sent).includes(`کارگاه ${RUN}`), labels(sent));
    check(
      "a project they are not linked to is not offered",
      !labels(sent).some((l) => l.startsWith("پروژه آزمون")),
      labels(sent),
    );
    const projectData = dataFor(sent, `کارگاه ${RUN}`);
    check("the button carries the project id", projectData === `project:${siteId}`, projectData);

    // 2. Walk the whole flow: project, category, amount, note, no invoice.
    sent.length = 0;
    await send(click(projectData!, FRESH_EMPLOYEE_TG));
    check("asks for a category", texts(sent).some((t) => t.includes("دسته‌بندی")), texts(sent));
    const categoryData = dataFor(sent, "مصالح");
    await send(click(categoryData!, FRESH_EMPLOYEE_TG));
    check("asks for an amount", texts(sent).some((t) => t.includes("تومان")), texts(sent));

    sent.length = 0;
    await send(message("1250000", FRESH_EMPLOYEE_TG));
    await send(message("توضیح آزمون خودکار", FRESH_EMPLOYEE_TG));
    await send(click("invoice:skip", FRESH_EMPLOYEE_TG));
    await send(click(dataFor(sent, "تأیید")!, FRESH_EMPLOYEE_TG));

    const expense = await prisma.expense.findFirst({
      where: { userId: employeeId, amount: 1_250_000n },
      orderBy: { createdAt: "desc" },
    });
    check("the expense was stored", !!expense, expense);
    check("on the assigned project", expense?.projectId === siteId, expense?.projectId);
    check("recorded by the new employee", expense?.userId === employeeId, expense?.userId);
    check(
      "the confirmation reads back in Persian",
      texts(sent).some((t) => t.includes(`کارگاه ${RUN}`) && t.includes("1,250,000 تومان")),
      texts(sent).slice(-1),
    );
    check(
      "a direct flow is announced to the linked group",
      sent.some(
        (c) =>
          c.method === "sendMessage" &&
          String(c.params.chat_id) === String(GROUP_CHAT) &&
          String(c.params.text).includes("کارمند تازه‌وارد") &&
          String(c.params.text).includes("1,250,000 تومان"),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    // 3. Deactivating the employee stops them, and keeps their expense.
    const off = await call("POST", `/api/admin/users/${employeeId}/status`, { isActive: false });
    check("deactivate the employee -> 200", off.status === 200, off.json);

    sent.length = 0;
    await send(message("/expense", FRESH_EMPLOYEE_TG));
    check(
      "the bot says they have no access",
      texts(sent).some((t) => t.includes("دسترسی ثبت هزینه ندارید")),
      texts(sent),
    );
    check("no project is offered", !labels(sent).some((l) => l.startsWith("کارگاه")), labels(sent));
    check(
      "their earlier expense is untouched",
      (await prisma.expense.count({ where: { userId: employeeId } })) === 1,
    );

    // 4. Reactivating the employee works and restores the same project.
    const on = await call("POST", `/api/admin/users/${employeeId}/status`, { isActive: true });
    check("reactivate the employee -> 200", on.status === 200, on.json);
    sent.length = 0;
    await send(message("/expense", FRESH_EMPLOYEE_TG));
    check("their project is offered again", labels(sent).includes(`کارگاه ${RUN}`), labels(sent));

    // 5. Deactivating the project hides it from the picker, keeping history.
    const siteOff = await call("POST", `/api/admin/projects/${siteId}/status`, { isActive: false });
    check("deactivate the project -> 200", siteOff.status === 200, siteOff.json);
    sent.length = 0;
    await send(message("/expense", FRESH_EMPLOYEE_TG));
    check(
      "the deactivated project is not offered",
      !labels(sent).some((l) => l.startsWith("کارگاه")),
      labels(sent),
    );
    check(
      "its expense is still on record",
      (await prisma.expense.count({ where: { projectId: siteId } })) === 1,
    );

    // 6. The admin sees both inactive rows in the management API.
    const users = await call("GET", "/api/admin/users");
    const projects = await call("GET", "/api/admin/projects");
    check(
      "the admin list includes inactive users",
      users.json?.users?.some((u: Json) => u?.id === employeeId),
    );
    check(
      "the admin list includes inactive projects",
      projects.json?.projects?.some((p: Json) => p?.id === siteId),
    );
    check(
      "the project still reports its expense",
      projects.json?.projects?.find((p: Json) => p?.id === siteId)?.expenseCount === 1,
      projects.json?.projects?.find((p: Json) => p?.id === siteId),
    );

    // 7. The deactivated project stays filterable on the dashboard for history.
    const page = await fetch(`${BASE_URL}/dashboard?project=${siteId}&all=1`, {
      headers: { cookie: ADMIN_COOKIE },
      redirect: "manual",
    });
    const html = await page.text();
    check("the dashboard renders for the admin", page.status === 200, page.status);
    check(
      "the inactive project is selectable in the filters",
      projectFilterHtml(html).includes(`value="${siteId}"`) && html.includes("کارگاه"),
    );
    check(
      "the expense of the inactive project is listed",
      html.includes("invoice_") && html.includes("توضیح آزمون خودکار"),
    );

    const withoutToggle = await fetch(`${BASE_URL}/dashboard?project=`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    check(
      "the toggle is off by default",
      !projectFilterHtml(await withoutToggle.text()).includes(`value="${siteId}"`),
    );
  }

  // ------------------------------------------------------- admin corrections
  section("Admin corrections: edit / delete / restore / history");
  {
    const proj = await call("POST", "/api/admin/projects", { name: `بازرسی ${RUN}` });
    const auditProjectId = proj.json?.project?.id ?? "";
    createdProjects.push(auditProjectId);
    const emp = await call("POST", "/api/admin/users", {
      name: "کاربر بازرسی",
      externalId: `888999${RUN}`,
      projectIds: [auditProjectId],
    });
    const auditUserId = emp.json?.user?.id ?? "";
    createdUsers.push(auditUserId);

    const expense = await prisma.expense.create({
      data: {
        projectId: auditProjectId,
        userId: auditUserId,
        category: "MATERIALS",
        amount: 500_000n,
        invoiceNumber: `aud_${RUN}_1`,
        expenseDate: new Date(),
      },
    });

    const noEdit = await call("PATCH", `/api/admin/expenses/${expense.id}`, { amount: 600000 }, { auth: false });
    check("edit without a session -> 401", noEdit.status === 401, noEdit.status);
    const noDelete = await call("DELETE", `/api/admin/expenses/${expense.id}`, { reason: "x" }, { auth: false });
    check("delete without a session -> 401", noDelete.status === 401, noDelete.status);
    const noRestore = await call("POST", `/api/admin/expenses/${expense.id}/restore`, {}, { auth: false });
    check("restore without a session -> 401", noRestore.status === 401, noRestore.status);
    const noHistory = await call("GET", `/api/admin/expenses/${expense.id}/history`, undefined, { auth: false });
    check("history without a session -> 401", noHistory.status === 401, noHistory.status);

    const hist0 = await call("GET", `/api/admin/expenses/${expense.id}/history`);
    check("history starts empty", hist0.status === 200 && unsafeLen(hist0.json?.history) === 0, hist0.json);

    const badEdit = await call("PATCH", `/api/admin/expenses/${expense.id}`, { amount: -5 });
    check("a negative amount -> 400", badEdit.status === 400, badEdit.json);

    const staleEdit = await call("PATCH", `/api/admin/expenses/${expense.id}`, {
      amount: 700000,
      expectedUpdatedAt: new Date(0).toISOString(),
    });
    check("a stale concurrency token -> 409", staleEdit.status === 409, staleEdit.json);

    const nowRow = await prisma.expense.findUnique({ where: { id: expense.id } });
    const edited = await call("PATCH", `/api/admin/expenses/${expense.id}`, {
      amount: 600000,
      description: "اصلاح شد",
      expectedUpdatedAt: nowRow?.updatedAt.toISOString(),
    });
    check("edit -> 200", edited.status === 200, edited.json);
    eq("the amount is updated", edited.json?.expense?.amount, 600000);
    eq("the description is updated", edited.json?.expense?.description, "اصلاح شد");
    check(
      "an audit EDIT row is written",
      (await prisma.expenseAuditLog.count({ where: { expenseId: expense.id, action: "EDIT" } })) === 1,
    );
    const hist1 = await call("GET", `/api/admin/expenses/${expense.id}/history`);
    check(
      "history lists the edit as an action",
      hist1.status === 200 && (hist1.json?.history?.[0]?.actionLabel as string) === "ویرایش",
      hist1.json,
    );

    const deleted = await call("DELETE", `/api/admin/expenses/${expense.id}`, { reason: "تکراری" });
    check("delete -> 200", deleted.status === 200, deleted.json);
    check(
      "the row is soft-deleted",
      (await prisma.expense.findUnique({ where: { id: expense.id } }))?.deletedAt !== null,
    );
    eq(
      "the delete reason is kept",
      (await prisma.expense.findUnique({ where: { id: expense.id } }))?.deletedReason,
      "تکراری",
    );
    check(
      "an audit DELETE row is written",
      (await prisma.expenseAuditLog.count({ where: { expenseId: expense.id, action: "DELETE" } })) === 1,
    );

    const restored = await call("POST", `/api/admin/expenses/${expense.id}/restore`);
    check("restore -> 200", restored.status === 200, restored.json);
    check(
      "the row is restored",
      (await prisma.expense.findUnique({ where: { id: expense.id } }))?.deletedAt === null,
    );
    check(
      "an audit RESTORE row is written",
      (await prisma.expenseAuditLog.count({ where: { expenseId: expense.id, action: "RESTORE" } })) === 1,
    );

    await call("DELETE", `/api/admin/expenses/${expense.id}`, {});
    const deletedPage = await fetch(`${BASE_URL}/dashboard?project=${auditProjectId}&deleted=1`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    const deletedHtml = await deletedPage.text();
    check("the deleted view lists the soft-deleted row", deletedHtml.includes(`aud_${RUN}_1`));
    check(
      "the deleted view offers a restore action",
      deletedHtml.includes("بازگردانی") && deletedHtml.includes(String(expense.id)),
    );
    const defaultPage = await fetch(`${BASE_URL}/dashboard?project=${auditProjectId}`, {
      headers: { cookie: ADMIN_COOKIE },
    });
    check(
      "the default view hides soft-deleted rows",
      !(await defaultPage.text()).includes(`aud_${RUN}_1`),
    );
  }

  // ------------------------------------------------------- cancellation window
  section("Cancellation window settings");
  {
    const defaults = await call("GET", "/api/admin/cancellation-settings");
    check("read cancellation settings -> 200", defaults.status === 200, defaults.status);
    check(
      "the default window is a sensible number",
      typeof defaults.json?.settings?.windowMinutes === "number",
      defaults.json,
    );
    const outOfRange = await call("POST", "/api/admin/cancellation-settings", { windowMinutes: 5000 });
    check("a window above one day -> 400", outOfRange.status === 400, outOfRange.json);
    const savedWindow = await call("POST", "/api/admin/cancellation-settings", { windowMinutes: 0 });
    check("disable the window -> 200", savedWindow.status === 200, savedWindow.json);
    eq("the disabled value is persisted", savedWindow.json?.settings?.windowMinutes, 0);
    const cleanup = await call("POST", "/api/admin/cancellation-settings", { windowMinutes: 15 });
    check("restore the default window -> 200", cleanup.status === 200, cleanup.json);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

/* ---------------------------------------------------------------- bot stubs */

type Sent = { method: string; params: Record<string, any> };
type Markup = { inline_keyboard?: { text: string; callback_data: string }[][] };

/** Enough of the Telegram API to run the guided flow, nothing more. */
function stubFetch(sent: Sent[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).slice(String(input).lastIndexOf("/") + 1);
    const params = init?.body ? JSON.parse(String(init.body)) : {};
    sent.push({ method, params });

    const json = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        headers: { "content-type": "application/json" },
      });

    if (method === "sendMessage") {
      return json({
        message_id: 1,
        date: 0,
        chat: { id: params.chat_id, type: "private" },
      });
    }
    if (method === "answerCallbackQuery") return json(true);
    if (method === "getMe") {
      return json({ id: 42, is_bot: true, first_name: "Test", username: "hazineyar_test_bot" });
    }
    throw new Error(`unexpected api call: ${method}`);
  }) as typeof fetch;
}

let updateId = 0;
const now = () => Math.floor(Date.now() / 1000);

function message(text: string, from: string) {
  const isCommand = text.startsWith("/");
  const length = isCommand ? text.split(/\s/)[0].length : 0;
  const id = Number(from);

  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: { id, type: "private", first_name: "تست" },
      from: { id, is_bot: false, first_name: "تست" },
      text,
      ...(isCommand ? { entities: [{ type: "bot_command", offset: 0, length }] } : {}),
    },
  };
}

function click(data: string, from: string) {
  const id = Number(from);
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++updateId),
      from: { id, is_bot: false, first_name: "تست" },
      chat_instance: "ci",
      data,
      message: {
        message_id: ++updateId,
        date: now(),
        chat: { id, type: "private", first_name: "تست" },
        text: "keyboard",
      },
    },
  };
}

const texts = (sent: Sent[]) =>
  sent.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text ?? ""));

const labels = (sent: Sent[]) =>
  sent.flatMap((call) => {
    const markup = call.params.reply_markup as Markup | undefined;
    return (markup?.inline_keyboard ?? []).flatMap((row) => row.map((b) => b.text));
  });

function dataFor(sent: Sent[], label: string): string | undefined {
  for (const call of sent) {
    const markup = call.params.reply_markup as Markup | undefined;
    for (const row of markup?.inline_keyboard ?? []) {
      const found = row.find((b) => b.text === label);
      if (found) return found.callback_data;
    }
  }
  return undefined;
}

main()
  .catch((error) => {
    console.error("\nTest run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Leave no fixture rows behind: the expenses reference the users and the
    // projects, so they are removed first.
    await prisma.expense.deleteMany({ where: { projectId: { in: createdProjects } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.project.deleteMany({ where: { id: { in: createdProjects } } });
    await prisma.accessRequest.deleteMany({
      where: {
        externalId: {
          in: [REQUEST_TG, REJECT_TG, HOSTILE_TG, NAME_TG, DUP_TG, RENAME_TG, BADGE_TG],
        },
      },
    });
    await prisma.linkedChat.deleteMany({ where: { channel: "telegram" } });
    // Restore the built-in announcement defaults for the next run.
    await prisma.setting.deleteMany({ where: { key: "announcement" } });
    await prisma.$disconnect();
  });
