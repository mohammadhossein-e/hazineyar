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
import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createBot } from "../src/adapters/telegram/bot";

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

/** The same HMAC token lib/auth.ts derives from ADMIN_PASSWORD. */
const ADMIN_COOKIE = `hazineyar_admin=${createHmac(
  "sha256",
  process.env.ADMIN_PASSWORD ?? "admin123",
)
  .update("hazineyar.dashboard.v1")
  .digest("hex")}`;

type Json = Record<string, any> | null;

async function call(
  method: "GET" | "POST",
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
    ] as const;
    for (const [method, path] of guarded) {
      const { status } = await call(method, path, { isActive: false, projectIds: [] }, { auth: false });
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
        duplicate.json.error.message.includes("شناسه تلگرام"),
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
      html.includes(`value="${siteId}"`) && html.includes("کارگاه"),
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
      !(await withoutToggle.text()).includes(`value="${siteId}"`),
    );
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
    await prisma.$disconnect();
  });
