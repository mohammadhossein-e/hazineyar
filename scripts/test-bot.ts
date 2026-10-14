/**
 * Offline end-to-end check for the Telegram adapter.
 *
 * The bot talks to a stubbed Telegram API, so this runs without a token and
 * without network access, while still exercising the real conversation
 * middleware, the real uploads directory, and the real database.
 *
 * Usage:
 *   npm run test:bot              (or: npx tsx scripts/test-bot.ts)
 */
import "./test-env";

import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { config } from "../src/lib/config";
import { createBot } from "../src/adapters/telegram/bot";
import {
  formatAmount,
  parseAmount,
  parseDescription,
} from "../src/adapters/telegram/format";
import {
  approveAccessRequest,
  rejectAccessRequest,
} from "../src/core/access/service";
import { PENDING_REQUEST_CAP } from "../src/core/access/schemas";
import type { Notifier } from "../src/core/notify";
import {
  updateAnnouncementSettings,
  updateCancellationSettings,
} from "../src/core/settings/service";
import { parseQuickEntry } from "../src/core/expenses/quick-entry";
import { lastChoiceShortcut, MESSAGES } from "../src/adapters/telegram/messages";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}`);
    if (detail !== undefined) {
      console.log(`      ${JSON.stringify(detail).slice(0, 400)}`);
    }
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, Object.is(actual, expected), { actual, expected });
}

/** Valid 1x1 PNG, a realistic stand-in for an invoice photo. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const EMPLOYEE_ID = 999_000_111;
const UNKNOWN_ID = 999_000_555;
const LONELESS_ID = 999_000_333;
const DISABLED_ID = 999_000_222;
const ADMIN_ID = 999_000_444;
const GROUP_UNKNOWN_ID = 999_000_999;
const GROUP_STRANGER_ID = 999_000_888;
const CAP_USER_ID = 999_000_777;

/** A group an admin links, and one that is never linked. */
const LINKED_GROUP_ID = -100_777_000_111;
const UNLINKED_GROUP_ID = -100_777_000_222;
let updateId = 0;

type Sent = { method: string; params: Record<string, unknown> };
type Markup = {
  inline_keyboard?: { text: string; callback_data?: string; url?: string }[][];
};

/**
 * `getFile` hands back a path per file id, so the tests can tell which
 * `PhotoSize` was picked: a photo arrives in several sizes and only the
 * largest one is worth downloading.
 */
const FILE_PATHS: Record<string, string> = {
  small: "photos/f_small.jpg",
  big: "photos/f_big.jpg",
  "doc-jpeg": "documents/f_jpeg.jpg",
  "doc-png": "documents/f_png.png",
  "doc-pdf": "documents/f_invoice.pdf",
  "doc-txt": "documents/f_note.txt",
  "doc-png-named": "documents/f_named",
  "doc-unknown": "documents/f_mystery",
  "doc-huge": "documents/f_huge.jpg",
};

/**
 * Stubs the HTTP boundary, which is the only seam that reaches the contexts the
 * conversations plugin rebuilds during replay: it creates a fresh `Api` from
 * `protoApi.options` for each of them, so a `config.use` transformer on
 * `bot.api` would not be inherited.
 */
/**
 * grammy uploads an `InputFile` as a custom multipart stream, not as a web
 * `FormData`, so the stub parses whatever the body is down to stringy params.
 * File parts are flattened to `{ file: true }`.
 */
async function parseBody(init?: RequestInit): Promise<Record<string, unknown>> {
  const body = init?.body;
  if (!body) return {};
  if (body instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      out[key] = typeof value === "string" ? value : { file: true };
    }
    return out;
  }
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const contentType = String(
    headers["content-type"] ?? (init?.headers instanceof Headers ? init.headers.get("content-type") : ""),
  );
  if (contentType.includes("multipart/form-data") && typeof body !== "string") {
    const raw = Buffer.from(
      await new Response(body as BodyInit).arrayBuffer(),
    );
    const boundary = contentType.split("boundary=")[1] ?? "";
    const out: Record<string, unknown> = {};
    for (const part of raw.toString("utf8").split(`--${boundary}`)) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd === -1) continue;
      const partHeaders = part.slice(0, headerEnd);
      const name = partHeaders.match(/name="([^"]+)"/)?.[1];
      if (!name) continue;
      if (partHeaders.includes("filename=")) {
        out[name] = { file: true };
      } else {
        out[name] = part.slice(headerEnd + 4).replace(/\r\n$/, "");
      }
    }
    return out;
  }
  if (typeof body === "string") return JSON.parse(body);
  return {};
}

function stubFetch(
  sent: Sent[],
  options: { failChatIds?: Set<string> } = {},
): typeof fetch {
  const json = (result: unknown) =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });
  const forbidden = () =>
    new Response(
      JSON.stringify({ ok: false, error_code: 403, description: "Forbidden" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/file/bot")) {
      return fileResponse();
    }

    const method = url.slice(url.lastIndexOf("/") + 1);
    const params = await parseBody(init);
    sent.push({ method, params });

    const chatId = String(params.chat_id ?? "");
    if (
      (method === "sendMessage" || method === "sendDocument") &&
      options.failChatIds?.has(chatId)
    ) {
      return forbidden();
    }

    switch (method) {
      case "sendMessage":
      case "sendDocument":
        return json({
          message_id: 1,
          date: 0,
          chat: { id: params.chat_id, type: "private" },
        });
      case "answerCallbackQuery":
        return json(true);
      case "getFile": {
        const fileId = String(params.file_id);
        const filePath = FILE_PATHS[fileId];
        if (!filePath) throw new Error(`unexpected file_id: ${fileId}`);
        return json({
          file_id: fileId,
          file_unique_id: `u-${fileId}`,
          file_path: filePath,
        });
      }
      case "getMe":
        return json({
          id: 42,
          is_bot: true,
          first_name: "Test",
          username: "hazineyar_test_bot",
        });
      default:
        throw new Error(`unexpected api call: ${method}`);
    }
  }) as typeof fetch;
}

/**
 * The file endpoint is stubbed to answer with `application/octet-stream` for
 * everything, which is what api.telegram.org does in practice: it sends that
 * type whatever it is serving. Every stored extension below therefore has to
 * come from the type Telegram reported on the message, never from this header
 * — which is exactly the bug this harness pins down.
 */
function fileResponse(): Response {
  return new Response(PNG_BYTES, {
    headers: { "content-type": "application/octet-stream" },
  });
}


const user = (id: number) => ({
  id,
  is_bot: false,
  first_name: "تست",
});

const chat = (id: number) => ({ id, type: "private" as const, first_name: "تست" });
const now = () => Math.floor(Date.now() / 1000);

function message(text: string, from = EMPLOYEE_ID) {
  // Telegram marks the leading token with a `bot_command` entity, and grammy
  // only matches commands when that entity is present.
  const isCommand = text.startsWith("/");
  const length = isCommand ? text.split(/\s/)[0].length : 0;

  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: chat(from),
      from: user(from),
      text,
      ...(isCommand
        ? { entities: [{ type: "bot_command", offset: 0, length }] }
        : {}),
    },
  };
}

function photo(from = EMPLOYEE_ID, caption?: string) {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: chat(from),
      from: user(from),
      photo: [
        { file_id: "small", file_unique_id: "s1", width: 90, height: 90 },
        { file_id: "big", file_unique_id: "b1", width: 1280, height: 960 },
      ],
      ...(caption ? { caption } : {}),
    },
  };
}

/** The same picture, but sent with the paperclip instead of the camera. */
function document(
  fileId: string,
  fields: { mime_type?: string; file_name?: string; file_size?: number } = {},
  from = EMPLOYEE_ID,
) {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: chat(from),
      from: user(from),
      document: { file_id: fileId, file_unique_id: `u-${fileId}`, ...fields },
    },
  };
}

function click(data: string, from = EMPLOYEE_ID) {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++updateId),
      from: user(from),
      chat_instance: "ci",
      data,
      message: {
        message_id: ++updateId,
        date: now(),
        chat: chat(from),
        text: "keyboard",
      },
    },
  };
}

/** A command (or plain text) inside a (super)group chat. */
function groupMessage(
  text: string,
  from = EMPLOYEE_ID,
  chatId = LINKED_GROUP_ID,
  title = "گروه شرکت",
) {
  const isCommand = text.startsWith("/");
  const length = isCommand ? text.split(/\s/)[0].length : 0;

  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: { id: chatId, type: "supergroup" as const, title },
      from: user(from),
      text,
      ...(isCommand
        ? { entities: [{ type: "bot_command", offset: 0, length }] }
        : {}),
    },
  };
}

const texts = (sent: Sent[]) =>
  sent.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text ?? ""));

function fromOf(update: any): string {
  return String(update?.message?.from?.id ?? update?.callback_query?.from?.id ?? "?");
}

/** The file ids `getFile` was asked for, in order. */
const fetched = (sent: Sent[]) =>
  sent.filter((c) => c.method === "getFile").map((c) => String(c.params.file_id));

/** The URL of the inline button carrying this label, if any. */
function urlFor(sent: Sent[], label: string): string | undefined {
  for (const call of sent) {
    const markup = call.params.reply_markup as Markup | undefined;
    for (const row of markup?.inline_keyboard ?? []) {
      const found = row.find((b) => b.text === label);
      if (found?.url) return found.url;
    }
  }
  return undefined;
}

/** Callback data of the button carrying this label, across all replies. */
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

const labels = (sent: Sent[]) => {
  const out: string[] = [];
  for (const call of sent) {
    const markup = call.params.reply_markup as Markup | undefined;
    for (const row of markup?.inline_keyboard ?? []) {
      out.push(...row.map((b) => b.text));
    }
  }
  return out;
};

async function main() {
  console.log("telegram adapter\n");

  console.log("amount parsing");
  eq("plain digits", parseAmount("1250000"), 1_250_000);
  eq("persian digits", parseAmount("۱۲۵۰۰۰۰"), 1_250_000);
  eq("arabic-indic digits", parseAmount("١٢٥٠٠٠٠"), 1_250_000);
  eq("thousands separators", parseAmount("1,250,000"), 1_250_000);
  eq("persian separators", parseAmount("۱٬۲۵۰٬۰۰۰"), 1_250_000);
  eq("surrounding spaces", parseAmount("  125000  "), 125_000);
  eq("rejects decimals", parseAmount("1250.5"), null);
  eq("rejects zero", parseAmount("0"), null);
  eq("rejects negatives", parseAmount("-500"), null);
  eq("rejects words", parseAmount("یک میلیون"), null);
  eq("rejects empty", parseAmount(""), null);
  eq("rejects exponent shorthand", parseAmount("1e6"), null);
  eq("formats with separators", formatAmount(1_250_000n), "1,250,000");

  console.log("\ndescription parsing");
  eq("keeps free text", parseDescription("خرید سیمان"), "خرید سیمان");
  eq("trims surrounding whitespace", parseDescription("  خرید سیمان  "), "خرید سیمان");
  eq("keeps inner spacing", parseDescription("سیمان ۲۰ کیسه"), "سیمان ۲۰ کیسه");
  eq("whitespace only means no note", parseDescription("   "), "");
  eq("accepts exactly the limit", parseDescription("ا".repeat(500)), "ا".repeat(500));
  eq("rejects one over the limit", parseDescription("ا".repeat(501)), null);

  console.log("\none-line parsing (pure)");
  const parserProjects = [
    { id: "p1", name: "سعادت‌آباد" },
    { id: "p2", name: "پاسداران" },
  ];
  const parsedFull = parseQuickEntry("سعادت‌آباد مصالح ۱٬۲۵۰٬۰۰۰ خرید سیمان", parserProjects);
  eq("full line kind", parsedFull.kind, "parsed");
  if (parsedFull.kind === "parsed") {
    eq("full line amount", parsedFull.amount, 1_250_000);
    eq("full line project", parsedFull.project?.id, "p1");
    eq("full line category", parsedFull.category, "MATERIALS");
    eq("full line description", parsedFull.description, "خرید سیمان");
  }
  const noProject = parseQuickEntry("مصالح 30000", parserProjects);
  eq("missing project stays null", noProject.kind === "parsed" ? noProject.project : "x", null);
  eq("missing project keeps amount", noProject.kind === "parsed" ? noProject.amount : null, 30_000);
  const englishKey = parseQuickEntry("پاسداران WAGES 1500000", parserProjects);
  eq("enum key accepted", englishKey.kind === "parsed" ? englishKey.category : null, "WAGES");
  eq("enum key project", englishKey.kind === "parsed" ? englishKey.project?.id : null, "p2");
  const zwnj = parseQuickEntry(
    `${parserProjects[0].name.replace(/\u200c/g, "")} مصالح 5000`,
    parserProjects,
  );
  eq("ZWNJ-insensitive project match", zwnj.kind === "parsed" ? zwnj.project?.id : null, "p1");
  const zero = parseQuickEntry("سعادت‌آباد مصالح ۰", parserProjects);
  eq("a zero amount is invalid", zero.kind, "invalid-amount");
  const negative = parseQuickEntry("سعادت‌آباد مصالح -۵", parserProjects);
  eq("a negative amount is invalid", negative.kind, "invalid-amount");
  const noAmount = parseQuickEntry("سعادت‌آباد مصالح", parserProjects);
  eq("a name with no amount stays parsed", noAmount.kind, "parsed");
  eq(
    "and reports no amount",
    noAmount.kind === "parsed" ? noAmount.amount : 1,
    null,
  );
  eq(
    "and never invents a description",
    noAmount.kind === "parsed" ? noAmount.description : "x",
    null,
  );
  const chatter = parseQuickEntry("سلام حال شما خوبه؟", parserProjects);
  eq(
    "ordinary chatter recognised nothing",
    chatter.kind === "parsed"
      ? chatter.amount === null && chatter.project === null && chatter.category === null
      : false,
    true,
  );
  eq("blank input is empty", parseQuickEntry("   ", parserProjects).kind, "empty");

  const projects = await prisma.project.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  if (projects.length === 0) {
    throw new Error("no active project; run `npm run prisma:seed` first");
  }
  const [mine, foreign] = projects;

  // A crashed run can leave the fixtures behind; start from a clean slate.
  await prisma.user.deleteMany({
    where: { externalId: { startsWith: "999000" } },
  });
  await prisma.accessRequest.deleteMany({
    where: { externalId: { startsWith: "999000" } },
  });

  let approvedUserId: string | null = null;

  const employee = await prisma.user.create({
    data: {
      name: "کاربر تست ربات",
      channel: "telegram",
      externalId: String(EMPLOYEE_ID),
      userProjects: { create: [{ projectId: mine.id }] },
    },
  });
  const loneless = await prisma.user.create({
    data: {
      name: "بدون پروژه",
      channel: "telegram",
      externalId: String(LONELESS_ID),
    },
  });
  // Deactivated by the owner from the admin screen: the account is known, so
  // the bot must refuse it instead of claiming it was never registered.
  const disabled = await prisma.user.create({
    data: {
      name: "کاربر غیرفعال",
      channel: "telegram",
      externalId: String(DISABLED_ID),
      isActive: false,
      userProjects: { create: [{ projectId: mine.id }] },
    },
  });
  // A project the owner switched off. It is linked to the employee on purpose,
  // so hiding it has to come from the project being inactive, not from access
  // being revoked.
  const closedProject = await prisma.project.create({
    data: {
      name: "پروژه تعطیل‌شده",
      isActive: false,
      userProjects: { create: [{ userId: employee.id }] },
    },
  });

  const sent: Sent[] = [];
  const bot = createBot("test:token", { client: { fetch: stubFetch(sent) } });

  // The invoice download uses the global fetch, not grammy's transport.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (!String(input).includes("/file/bot")) {
      throw new Error(`unexpected global fetch: ${String(input)}`);
    }
    return fileResponse();
  }) as typeof fetch;

  await bot.init();
  sent.length = 0;

  /**
   * Drives one update, then — unless auto-confirm is off — approves the
   * summary step automatically the moment the confirmation keyboard appears.
   * Every existing flow can therefore stay written as before while the new
   * summary step runs underneath; the dedicated confirmation/edit/cancel tests
   * switch autoConfirm off and drive those buttons themselves.
   */
  let autoConfirm = true;
  const makeSend = (targetBot: ReturnType<typeof createBot>, targetSent: Sent[]) =>
    async (update: unknown) => {
      const before = targetSent.length;
      await targetBot.handleUpdate(update as never);
      if (!autoConfirm) return;
      const newSent = targetSent.slice(before);
      const data = dataFor(newSent, MESSAGES.confirm);
      if (data) {
        await targetBot.handleUpdate(click(data, Number(fromOf(update))) as never);
      }
    };
  const send = makeSend(bot, sent);

  const admin = await prisma.user.create({
    data: {
      name: "ادمین تست",
      channel: "telegram",
      externalId: "999000444",
      role: "ADMIN",
    },
  });

  const created = async (userId: string, amount: bigint) =>
    prisma.expense.findFirst({
      where: { userId, amount },
      orderBy: { createdAt: "desc" },
    });

  try {
    console.log("\nunregistered user");
    sent.length = 0;
    await send(message("/expense", UNKNOWN_ID));
    check(
      "request recorded and the manager's approval is announced",
      texts(sent).some((t) => t.includes("درخواست دسترسی")),
      texts(sent),
    );
    const pendingRequest = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "telegram", externalId: String(UNKNOWN_ID) } },
    });
    check("pending access request created", pendingRequest?.status === "PENDING", pendingRequest);
    check("display name is captured", pendingRequest?.displayName === "تست", pendingRequest?.displayName);
    check(
      "no user auto-created",
      (await prisma.user.count({ where: { externalId: String(UNKNOWN_ID) } })) === 0,
    );

    console.log("\nuser with no projects");
    sent.length = 0;
    await send(message("/expense", LONELESS_ID));
    check(
      "explains there are no projects",
      texts(sent).some((t) => t.includes("پروژه فعالی")),
      texts(sent),
    );

    console.log("\ndeactivated user");
    sent.length = 0;
    await send(message("/expense", DISABLED_ID));
    check(
      "told they no longer have access",
      texts(sent).some((t) => t.includes("دسترسی ثبت هزینه ندارید")),
      texts(sent),
    );
    check(
      "not mistaken for an unregistered user",
      !texts(sent).some((t) => t.includes("ثبت نشده‌اید")),
      texts(sent),
    );
    check(
      "no project is offered",
      !labels(sent).some((l) => l === mine.name),
      labels(sent),
    );
    check(
      "nothing was written",
      (await prisma.expense.count({ where: { userId: disabled.id } })) === 0,
    );

    console.log("\ndeactivated project");
    sent.length = 0;
    await send(message("/expense"));
    check(
      "a linked but inactive project is not offered",
      !labels(sent).includes(closedProject.name),
      labels(sent),
    );
    check(
      "the active one still is",
      labels(sent).includes(mine.name),
      labels(sent),
    );
    await send(click("flow:cancel"));

    console.log("\ncommands");
    sent.length = 0;
    await send(message("/start"));
    check("/start greets", texts(sent).some((t) => t.includes("خوش آمدید")));
    sent.length = 0;
    await send(message("سلام"));
    check(
      "stray text points at /expense",
      texts(sent).some((t) => t.includes("/expense")),
      texts(sent),
    );

    console.log("\nhappy path with an invoice photo");
    sent.length = 0;
    await send(message("/expense"));
    check("asks for a project", texts(sent).some((t) => t.includes("پروژه")));
    check("lists the assigned project", labels(sent).includes(mine.name));
    if (foreign) {
      check("hides the unassigned project", !labels(sent).includes(foreign.name));
    }
    const projectData = dataFor(sent, mine.name);
    check("project button carries an id", projectData === `project:${mine.id}`);

    sent.length = 0;
    await send(message("بی‌ربط"));
    check(
      "off-keyboard text re-prompts",
      texts(sent).some((t) => t.includes("پروژه")),
      texts(sent),
    );

    sent.length = 0;
    await send(click(projectData!));
    check("asks for a category", texts(sent).some((t) => t.includes("دسته‌بندی")));
    eq("all six categories offered", labels(sent).length, 7);
    const categoryData = dataFor(sent, "مصالح");
    eq("category button value", categoryData, "category:MATERIALS");

    sent.length = 0;
    await send(click(categoryData!));
    check("asks for an amount", texts(sent).some((t) => t.includes("تومان")));

    sent.length = 0;
    await send(message("خیلی زیاد"));
    check("words rejected", texts(sent).some((t) => t.includes("نامعتبر")));
    await send(message("12.5"));
    check("decimals rejected", texts(sent).some((t) => t.includes("نامعتبر")));
    await send(message("0"));
    check("zero rejected", texts(sent).some((t) => t.includes("نامعتبر")));
    eq(
      "nothing written while the amount is invalid",
      await prisma.expense.count({ where: { userId: employee.id } }),
      0,
    );

    sent.length = 0;
    await send(message("۱٬۲۵۰٬۰۰۰"));
    check("asks for a description", texts(sent).some((t) => t.includes("توضیحات")));
    eq("description skip button value", dataFor(sent, "رد کردن"), "description:skip");
    check(
      "no invoice is asked for yet",
      !texts(sent).some((t) => t.includes("فاکتور")),
      texts(sent),
    );

    // Over-long first, to show the step re-prompts instead of truncating.
    sent.length = 0;
    await send(message("ا".repeat(501)));
    check(
      "an over-long description is refused",
      texts(sent).some((t) => t.includes("طولانی")),
      texts(sent),
    );
    check(
      "the limit is spelled out",
      texts(sent).some((t) => t.includes("500")),
      texts(sent),
    );
    eq(
      "nothing written while the description is refused",
      await prisma.expense.count({ where: { userId: employee.id } }),
      0,
    );

    sent.length = 0;
    await send(message("  خرید ۲۰ کیسه سیمان  "));
    check("asks for an invoice", texts(sent).some((t) => t.includes("فاکتور")));
    eq("skip button value", dataFor(sent, "بدون فاکتور"), "invoice:skip");

    sent.length = 0;
    await send(photo());
    check("acknowledges the photo", texts(sent).some((t) => t.includes("دریافت شد")));
    check(
      "the largest PhotoSize is downloaded",
      fetched(sent).join() === "big",
      fetched(sent),
    );

    const expense = await created(employee.id, 1_250_000n);
    check("expense row created", expense !== null);
    eq("category stored", expense?.category, "MATERIALS");
    eq("project stored", expense?.projectId, mine.id);
    eq("recorded by the right user", expense?.userId, employee.id);
    eq("description stored, trimmed", expense?.description, "خرید ۲۰ کیسه سیمان");
    check(
      "invoice attached",
      typeof expense?.invoiceFilePath === "string",
      expense?.invoiceFilePath,
    );
    // The file endpoint answered application/octet-stream, so the extension
    // could only come from the message: Telegram sends every photo as JPEG.
    check(
      "a photo is stored as .jpg whatever the download said",
      expense?.invoiceFilePath?.endsWith(".jpg") === true,
      expense?.invoiceFilePath,
    );
    check(
      "confirmation shows the formatted amount",
      texts(sent).some((t) => t.includes("1,250,000 تومان")),
      texts(sent),
    );
    check(
      "confirmation shows the description",
      texts(sent).some((t) => t.includes("توضیحات: خرید ۲۰ کیسه سیمان")),
      texts(sent).slice(-1),
    );
    check(
      "confirmation shows the invoice number",
      texts(sent).some((t) => t.includes(expense?.invoiceNumber ?? "@@")),
    );
    check(
      "confirmation says the invoice is attached",
      texts(sent).some((t) => t.includes("فاکتور: پیوست شد")),
    );

    if (expense?.invoiceFilePath) {
      const bytes = await readFile(
        path.resolve(process.cwd(), config.uploadDir, expense.invoiceFilePath),
      );
      check("stored bytes match the photo", bytes.equals(PNG_BYTES));
    }

    console.log("\nskip-invoice path");
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:TRANSPORT"));
    await send(message("45000"));
    sent.length = 0;
    await send(click("description:skip"));
    check(
      "skipping the description moves on to the invoice",
      texts(sent).some((t) => t.includes("فاکتور")),
      texts(sent),
    );
    await send(click("invoice:skip"));
    const skipped = await created(employee.id, 45_000n);
    check("second expense created", skipped !== null);
    eq("no invoice on a skipped expense", skipped?.invoiceFilePath, null);
    eq("no description on a skipped one", skipped?.description, null);
    check(
      "confirmation says there is no invoice",
      texts(sent).some((t) => t.includes("فاکتور: ندارد")),
      texts(sent).slice(-1),
    );
    check(
      "a skipped description is left out of the confirmation",
      !texts(sent).some((t) => t.includes("توضیحات:")),
      texts(sent).slice(-1),
    );
    check(
      "invoice numbers increment per project",
      !!skipped &&
        !!expense &&
        skipped.invoiceNumber !== expense.invoiceNumber &&
        Number(skipped.invoiceNumber.split("_")[1]) -
          Number(expense.invoiceNumber.split("_")[1]) ===
          1,
      { a: expense?.invoiceNumber, b: skipped?.invoiceNumber },
    );

    // Everything below drives a whole flow per case, so the invoice step is
    // reached with a known amount and the row it writes can be looked up.
    const toInvoiceStep = async (amount: string, category = "MATERIALS") => {
      sent.length = 0;
      await send(message("/expense"));
      await send(click(`project:${mine.id}`));
      await send(click(`category:${category}`));
      await send(message(amount));
      await send(click("description:skip"));
    };

    console.log("\none-line entry: a full line is parsed, confirmed and saved");
    sent.length = 0;
    await send(message(`${mine.name} مصالح ۳٬۳۰۰٬۰۰۰ خرید سیمان`));
    const quickFull = await created(employee.id, 3_300_000n);
    check("the full line is saved", !!quickFull, quickFull);
    check(
      "the line goes straight to the summary",
      texts(sent).some((t) => t.includes("مبلغ: 3,300,000 تومان")),
      texts(sent),
    );
    check(
      "no project or category prompt is shown",
      !texts(sent).some(
        (t) => t.includes(MESSAGES.pickProject) || t.includes(MESSAGES.pickCategory),
      ),
      texts(sent),
    );
    eq("the parsed project is stored", quickFull?.projectId, mine.id);
    eq("the parsed category is stored", quickFull?.category, "MATERIALS");
    eq("the leftover becomes the note", quickFull?.description, "خرید سیمان");
    eq("no invoice on a text entry", quickFull?.invoiceFilePath, null);

    const rememberedRow = await prisma.user.findUnique({ where: { id: employee.id } });
    eq("the project is remembered", rememberedRow?.lastProjectId, mine.id);
    eq("the category is remembered", rememberedRow?.lastCategory, "MATERIALS");

    console.log("\none-line entry: the remembered shortcut is offered and used");
    sent.length = 0;
    await send(message("/expense"));
    const shortcutLabel = lastChoiceShortcut(mine.name, "مصالح");
    check(
      "the project step offers the previous pair",
      labels(sent).includes(shortcutLabel),
      labels(sent),
    );
    check(
      "the prompt also names it",
      texts(sent).some((t) => t.includes(`آخرین: ${mine.name}`)),
      texts(sent),
    );
    sent.length = 0;
    await send(click("last"));
    check(
      "the shortcut jumps straight to the amount",
      texts(sent).some((t) => t.includes("مبلغ هزینه را")),
      texts(sent),
    );
    await send(message("۴۴۰۰۰"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const shortcutSaved = await created(employee.id, 44_000n);
    check("the shortcut flow saves the expense", !!shortcutSaved, shortcutSaved);
    eq("with the remembered project", shortcutSaved?.projectId, mine.id);
    eq("and the remembered category", shortcutSaved?.category, "MATERIALS");

    console.log("\none-line entry: a line with no amount asks first");
    sent.length = 0;
    await send(message(`${mine.name} مصالح`));
    check(
      "the bot restates what it understood",
      texts(sent).some(
        (t) => t.includes("متوجه شدم") && t.includes(`پروژه: ${mine.name}`),
      ),
      texts(sent),
    );
    check(
      "and offers the continue button",
      labels(sent).includes(MESSAGES.quickContinue),
      labels(sent),
    );
    check(
      "no amount is asked before the tap",
      !texts(sent).some((t) => t.includes("مبلغ هزینه را")),
      texts(sent),
    );
    sent.length = 0;
    await send(click("quick:continue"));
    check(
      "the tap continues to the amount",
      texts(sent).some((t) => t.includes("مبلغ هزینه را")),
      texts(sent),
    );
    await send(message("۵۵۰۰۰"));
    await send(click("description:skip"));
    const continued = await created(employee.id, 55_000n);
    check("the continued flow saves", !!continued, continued);
    eq("with the recognised project", continued?.projectId, mine.id);
    eq("and category", continued?.category, "MATERIALS");

    console.log("\none-line entry: an unusable amount is refused up front");
    sent.length = 0;
    await send(message(`${mine.name} مصالح ۰`));
    check(
      "the amount is rejected with a hint",
      texts(sent).some((t) => t.includes("مبلغ نامعتبر")),
      texts(sent),
    );
    check(
      "and no flow is started",
      !labels(sent).some((l) => l.includes(mine.name)),
      labels(sent),
    );

    console.log("\none-line entry: a captioned photo is parsed and attached");
    sent.length = 0;
    await send(photo(EMPLOYEE_ID, `${mine.name} مصالح ۶۶۰۰۰ خرید میلگرد`));
    const photoQuick = await created(employee.id, 66_000n);
    check("the captioned photo is saved", !!photoQuick, photoQuick);
    check(
      "the invoice is attached without an invoice step",
      photoQuick?.invoiceFilePath?.endsWith(".jpg") === true,
      photoQuick?.invoiceFilePath,
    );
    eq("the caption supplies the project", photoQuick?.projectId, mine.id);
    eq("the caption supplies the note", photoQuick?.description, "خرید میلگرد");
    check(
      "the file is acknowledged",
      texts(sent).some((t) => t.includes("دریافت شد")),
      texts(sent),
    );

    console.log("\none-line entry: a photo with no caption opens the guided flow");
    sent.length = 0;
    await send(photo());
    check(
      "the file is acknowledged",
      texts(sent).some((t) => t.includes("دریافت شد")),
      texts(sent),
    );
    check(
      "and the project is asked",
      texts(sent).some((t) => t.includes(MESSAGES.pickProject)),
      texts(sent),
    );
    await send(click("flow:cancel"));

    console.log("\none-line entry: unknown and inactive senders");
    sent.length = 0;
    await send(photo(UNKNOWN_ID));
    eq("an unknown sender's photo is ignored", sent.length, 0);
    sent.length = 0;
    await send(photo(DISABLED_ID));
    eq("an inactive sender's photo is ignored", sent.length, 0);
    sent.length = 0;
    await send(message(`${mine.name} مصالح ۱۰۰۰`, UNKNOWN_ID));
    check(
      "an unknown sender's line is refused politely",
      texts(sent).some((t) => t.includes("ثبت نشده")),
      texts(sent),
    );

    console.log("\none-line entry: a stale remembered choice is not offered");
    // Point the memory at a linked-but-inactive project; the shortcut must
    // disappear because the pair is re-validated against what is offered now.
    await prisma.user.update({
      where: { id: employee.id },
      data: { lastProjectId: closedProject.id, lastCategory: "MATERIALS" },
    });
    sent.length = 0;
    await send(message("/expense"));
    check(
      "no shortcut while the remembered project is not offered",
      !labels(sent).some((l) => l.startsWith(MESSAGES.lastChoiceButton)),
      labels(sent),
    );
    check(
      "the accessible project is still listed",
      labels(sent).includes(mine.name),
      labels(sent),
    );
    await send(click("flow:cancel"));
    await prisma.user.update({
      where: { id: employee.id },
      data: { lastProjectId: mine.id, lastCategory: "MATERIALS" },
    });


    console.log("\ninvoice sent as a file (message.document)");
    for (const test of [
      { id: "doc-jpeg", mime: "image/jpeg", ext: "jpg", amount: "111111" },
      { id: "doc-png", mime: "image/png", ext: "png", amount: "222222" },
      { id: "doc-pdf", mime: "application/pdf", ext: "pdf", amount: "333333" },
    ]) {
      await toInvoiceStep(test.amount);
      sent.length = 0;
      await send(
        document(test.id, {
          mime_type: test.mime,
          file_name: `invoice.${test.ext}`,
          file_size: PNG_BYTES.byteLength,
        }),
      );
      check(`${test.mime} document is accepted`, texts(sent).some((t) => t.includes("دریافت شد")), texts(sent));
      const row = await created(employee.id, BigInt(test.amount));
      check(
        `${test.mime} document is stored as .${test.ext}`,
        row?.invoiceFilePath?.endsWith(`.${test.ext}`) === true,
        row?.invoiceFilePath,
      );
    }

    console.log("\ndocuments that must be refused");
    await toInvoiceStep("444444");
    sent.length = 0;
    await send(document("doc-txt", { mime_type: "text/plain", file_name: "note.txt" }));
    check(
      "a text document is refused by type",
      texts(sent).some((t) => t.includes("مجاز نیست")),
      texts(sent),
    );
    check(
      "the refused type is explained",
      texts(sent).some((t) => t.includes("image/jpeg")),
      texts(sent),
    );
    const refused = await created(employee.id, 444_444n);
    check("the expense is still recorded", refused !== null);
    eq("without an invoice", refused?.invoiceFilePath, null);

    await toInvoiceStep("555555");
    sent.length = 0;
    await send(document("doc-png-named", { file_name: "scan.png" }));
    check(
      "a document with no mime_type falls back to its name",
      texts(sent).some((t) => t.includes("دریافت شد")),
      texts(sent),
    );
    check(
      "and is stored as .png",
      (await created(employee.id, 555_555n))?.invoiceFilePath?.endsWith(".png") ===
        true,
    );

    await toInvoiceStep("666666");
    sent.length = 0;
    await send(document("doc-unknown", { file_name: "mystery" }));
    check(
      "a document with no mime_type and no usable name is refused",
      texts(sent).some((t) => t.includes("مجاز نیست")),
      texts(sent),
    );
    eq(
      "and nothing is attached",
      (await created(employee.id, 666_666n))?.invoiceFilePath,
      null,
    );

    await toInvoiceStep("777777");
    sent.length = 0;
    await send(
      document("doc-huge", {
        mime_type: "image/jpeg",
        file_name: "huge.jpg",
        file_size: 6 * 1024 * 1024,
      }),
    );
    check(
      "an oversized file is refused",
      texts(sent).some((t) => t.includes("مگابایت")),
      texts(sent),
    );
    check(
      "an oversized file is never downloaded",
      fetched(sent).length === 0,
      fetched(sent),
    );
    eq(
      "and nothing is attached",
      (await created(employee.id, 777_777n))?.invoiceFilePath,
      null,
    );

    console.log("\n/cancel during the flow");
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("999999"));
    check(
      "now waiting for a description",
      texts(sent).some((t) => t.includes("توضیحات")),
      texts(sent),
    );
    const before = await prisma.expense.count({ where: { userId: employee.id } });
    sent.length = 0;
    await send(message("/cancel"));
    check("cancel is acknowledged", texts(sent).some((t) => t.includes("لغو")));
    eq("nothing written", await prisma.expense.count({ where: { userId: employee.id } }), before);
    // A photo outside a flow is a new entry attempt: it is acknowledged and the
    // invoice is carried into a fresh guided flow, but still writes nothing
    // until that flow is confirmed.
    sent.length = 0;
    await send(photo());
    check(
      "a photo after cancel starts a fresh flow with the invoice attached",
      texts(sent).some((t) => t.includes("دریافت شد")),
      texts(sent),
    );
    eq(
      "the fresh flow writes nothing yet",
      await prisma.expense.count({ where: { userId: employee.id } }),
      before,
    );
    await send(click("flow:cancel"));
    sent.length = 0;
    await send(message("سلام"));
    check(
      "conversation really ended",
      texts(sent).some((t) => t.includes("/expense")),
      texts(sent),
    );

    console.log("\ninline cancel button");
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:TOOLS"));
    await send(message("1000"));
    sent.length = 0;
    await send(click("flow:cancel"));
    check("button cancel is acknowledged", texts(sent).some((t) => t.includes("لغو")));

    console.log("\naccess is re-checked at write time");
    if (foreign) {
      const link = await prisma.userProject.create({
        data: { userId: employee.id, projectId: foreign.id },
      });

      sent.length = 0;
      await send(message("/expense"));
      check(
        "linked project is now offered",
        labels(sent).includes(foreign.name),
        labels(sent),
      );

      // Access is dropped while the flow is mid-way, so the write itself is
      // what has to refuse it.
      sent.length = 0;
      await send(click(`project:${foreign.id}`));
      await send(click("category:WAGES"));
      await send(message("8000"));
      await send(click("description:skip"));
      await prisma.userProject.delete({ where: { id: link.id } });
      sent.length = 0;
      await send(click("invoice:skip"));

      const denied = await prisma.expense.findFirst({
        where: { userId: employee.id, amount: 8_000n },
      });
      check("revoked access writes nothing", denied === null);
      check(
        "the user is told why",
        texts(sent).some((t) => t.includes("مجاز")),
        sent.map((s) => `${s.method}:${JSON.stringify(s.params).slice(0, 90)}`),
      );
      check(
        "a retry button is offered",
        labels(sent).some((l) => l.includes("تلاش مجدد")),
        labels(sent),
      );

      sent.length = 0;
      await send(click("flow:retry"));
      check("retry restarts the flow", texts(sent).some((t) => t.includes("پروژه")));
      check(
        "retry no longer offers the revoked project",
        !labels(sent).includes(foreign.name),
        labels(sent),
      );
      await send(click("flow:cancel"));
    }

    console.log("\nadmin sees every project");
    sent.length = 0;
    await send(message("/expense", ADMIN_ID));
    for (const p of projects) {
      check(`admin is offered ${p.name}`, labels(sent).includes(p.name));
    }
    await send(click("flow:cancel", ADMIN_ID));

    console.log("\naccess requests: idempotent recording");
    sent.length = 0;
    await send(message("/start", GROUP_UNKNOWN_ID));
    check(
      "a /start records a request",
      texts(sent).some((t) => t.includes("درخواست دسترسی")),
      texts(sent),
    );
    eq(
      "first /start creates one row",
      await prisma.accessRequest.count({ where: { externalId: String(GROUP_UNKNOWN_ID) } }),
      1,
    );
    eq(
      "and never a user",
      await prisma.user.count({ where: { externalId: String(GROUP_UNKNOWN_ID) } }),
      0,
    );
    sent.length = 0;
    await send(message("/expense", GROUP_UNKNOWN_ID));
    eq(
      "a second message stays one row",
      await prisma.accessRequest.count({ where: { externalId: String(GROUP_UNKNOWN_ID) } }),
      1,
    );
    check(
      "still told the request is recorded",
      texts(sent).some((t) => t.includes("درخواست دسترسی")),
      texts(sent),
    );

    console.log("\naccess requests: rejection is sticky");
    const rejectedRow = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "telegram", externalId: String(GROUP_UNKNOWN_ID) } },
    });
    await rejectAccessRequest(rejectedRow!.id);
    sent.length = 0;
    await send(message("/expense", GROUP_UNKNOWN_ID));
    check(
      "rejected user hears a polite refusal",
      texts(sent).some((t) => t.includes("تایید نشده")),
      texts(sent),
    );
    eq(
      "no new row on a rejected user",
      await prisma.accessRequest.count({ where: { externalId: String(GROUP_UNKNOWN_ID) } }),
      1,
    );
    eq(
      "the row stays rejected",
      (await prisma.accessRequest.findUnique({ where: { id: rejectedRow!.id } }))?.status,
      "REJECTED",
    );

    console.log("\naccess requests: approval builds the user and notifies");
    const failingNotifier: Notifier = {
      notifyUser: async () => {
        throw new Error("user blocked the bot");
      },
    };
    const approved = await approveAccessRequest(
      {
        id: rejectedRow!.id,
        role: "EMPLOYEE",
        projectIds: [mine.id],
      },
      failingNotifier,
    );
    check("approval succeeds even if the notification fails", !!approved.user.id, approved.user);
    approvedUserId = approved.user.id;
    eq("notified is reported false", approved.notified, false);
    eq(
      "the request is now APPROVED",
      (await prisma.accessRequest.findUnique({ where: { id: rejectedRow!.id } }))?.status,
      "APPROVED",
    );
    eq(
      "the user is linked to the chosen project",
      await prisma.userProject.count({ where: { userId: approved.user.id, projectId: mine.id } }),
      1,
    );
    sent.length = 0;
    await send(message("/expense", GROUP_UNKNOWN_ID));
    check("the approved user can now record expenses", labels(sent).includes(mine.name), labels(sent));
    await send(click(`project:${mine.id}`, GROUP_UNKNOWN_ID));
    await send(click("category:OTHER", GROUP_UNKNOWN_ID));
    await send(message("123456", GROUP_UNKNOWN_ID));
    await send(message("توضیح از کاربر تازه", GROUP_UNKNOWN_ID));
    await send(click("invoice:skip", GROUP_UNKNOWN_ID));
    const approvedExpense = await prisma.expense.findFirst({
      where: { userId: approved.user.id, amount: 123_456n },
    });
    check("the approved user's expense is stored", !!approvedExpense, approvedExpense);
    eq("recorded by them", approvedExpense?.userId, approved.user.id);

    console.log("\naccess requests: the pending cap");
    await prisma.accessRequest.createMany({
      data: Array.from({ length: PENDING_REQUEST_CAP }, (_, i) => ({
        channel: "test-cap",
        externalId: `cap-user-${i}`,
        displayName: `cap ${i}`,
      })),
    });
    sent.length = 0;
    await send(message("/start", CAP_USER_ID));
    check(
      "overflow is answered with a busy message",
      texts(sent).some((t) => t.includes("امکان ثبت درخواست جدید")),
      texts(sent),
    );
    eq(
      "overflow creates nothing",
      await prisma.accessRequest.count({ where: { externalId: String(CAP_USER_ID) } }),
      0,
    );
    await prisma.accessRequest.deleteMany({ where: { channel: "test-cap" } });

    console.log("\ngroup mode: linking is admin-only");
    sent.length = 0;
    await send(message("/linkgroup"));
    check(
      "linkgroup is refused outside a group",
      texts(sent).some((t) => t.includes("فقط داخل گروه")),
      texts(sent),
    );
    sent.length = 0;
    await send(groupMessage("/linkgroup", LONELESS_ID, UNLINKED_GROUP_ID));
    check(
      "a non-admin is refused",
      texts(sent).some((t) => t.includes("فقط ادمین‌های ثبت‌شده")),
      texts(sent),
    );
    eq(
      "no link is created",
      await prisma.linkedChat.count({ where: { externalChatId: String(UNLINKED_GROUP_ID) } }),
      0,
    );
    sent.length = 0;
    await send(groupMessage("/linkgroup", ADMIN_ID, LINKED_GROUP_ID, "گروه شرکت"));
    check(
      "an admin links the group",
      texts(sent).some((t) => t.includes("متصل شد")),
      texts(sent),
    );
    check(
      "the link stores the title",
      (await prisma.linkedChat.findUnique({
        where: { channel_externalChatId: { channel: "telegram", externalChatId: String(LINKED_GROUP_ID) } },
      }))?.title === "گروه شرکت",
    );

    console.log("\ngroup mode: /expense in a linked group answers with a deep link");
    sent.length = 0;
    await send(groupMessage("/expense"));
    check(
      "told to continue in the private chat",
      texts(sent).some((t) => t.includes("چت خصوصی")),
      texts(sent),
    );
    const deepLink = urlFor(sent, "ثبت در چت خصوصی");
    check(
      "the deep link carries the group payload",
      deepLink === `https://t.me/hazineyar_test_bot?start=g${Math.abs(LINKED_GROUP_ID)}`,
      deepLink,
    );
    check(
      "the multi-step flow never starts in the group",
      !labels(sent).includes(mine.name),
      labels(sent),
    );

    console.log("\ngroup mode: the @botname command form");
    sent.length = 0;
    await send(groupMessage("/expense@hazineyar_test_bot"));
    check(
      "expense@botname also answers with the deep link",
      !!urlFor(sent, "ثبت در چت خصوصی"),
      labels(sent),
    );

    console.log("\ngroup mode: unregistered member is pointed at /start");
    sent.length = 0;
    await send(groupMessage("/expense", GROUP_STRANGER_ID, LINKED_GROUP_ID));
    check(
      "told to /start in the private chat",
      texts(sent).some((t) => t.includes("/start")),
      texts(sent),
    );
    check(
      "a deep link is offered",
      !!urlFor(sent, "شروع چت خصوصی") || !!urlFor(sent, "ثبت در چت خصوصی"),
      labels(sent),
    );
    eq(
      "group chatter creates no access request",
      await prisma.accessRequest.count({ where: { externalId: String(GROUP_STRANGER_ID) } }),
      0,
    );

    console.log("\ngroup mode: /expense in an unlinked group is ignored");
    sent.length = 0;
    await send(groupMessage("/expense", EMPLOYEE_ID, LINKED_GROUP_ID));
    check("a linked group still answers", !!urlFor(sent, "ثبت در چت خصوصی"), labels(sent));
    sent.length = 0;
    await send(groupMessage("/expense", EMPLOYEE_ID, 100_000_000));
    check(
      "an unlinked group gets one short reply",
      texts(sent).some((t) => t.includes("/linkgroup")),
      texts(sent),
    );
    check(
      "and nothing else",
      sent.filter((c) => c.method === "sendMessage").length <= 1,
      sent.map((c) => c.method),
    );
    check(
      "no deep link is offered",
      !labels(sent).some((l) => l.includes("چت خصوصی")),
      labels(sent),
    );

    console.log("\ngroup mode: FULL announcement");
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    check("the deep link starts the private flow", labels(sent).includes(mine.name), labels(sent));
    await send(click(`project:${mine.id}`));
    await send(click("category:MATERIALS"));
    await send(message("2500000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const full = await created(employee.id, 2_500_000n);
    check("the expense is saved", !!full, full);
    const fullAnnouncement = sent.find(
      (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
    );
    check("an announcement is posted to the group", !!fullAnnouncement, sent.map((c) => c.method));
    const fullText = String(fullAnnouncement?.params.text ?? "");
    check("FULL names the user", fullText.includes("کاربر تست ربات"), fullText);
    check("FULL shows the project", fullText.includes(mine.name), fullText);
    check("FULL shows the amount", fullText.includes("2,500,000 تومان"), fullText);
    check(
      "FULL includes the invoice number",
      fullText.includes(full?.invoiceNumber ?? "@@"),
      fullText,
    );

    console.log("\ngroup mode: MINIMAL announcement");
    await updateAnnouncementSettings({
      announceMode: "MINIMAL",
      includeInvoice: true,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("777000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const minimalAnnouncement = sent.find(
      (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
    );
    eq(
      "MINIMAL says just who and where",
      String(minimalAnnouncement?.params.text ?? ""),
      `✅ ثبت شد: کاربر تست ربات | ${mine.name}`,
    );
    check(
      "MINIMAL drops the amount",
      !String(minimalAnnouncement?.params.text ?? "").includes("777,000"),
    );

    console.log("\ngroup mode: OFF announcement");
    await updateAnnouncementSettings({
      announceMode: "OFF",
      includeInvoice: true,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("888000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check("nothing is sent to the group when OFF", !sent.some(
      (c) => String(c.params.chat_id) === String(LINKED_GROUP_ID),
    ));

    console.log("\ngroup mode: includeInvoice on");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: true,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await send(click(`project:${mine.id}`));
    await send(click("category:MATERIALS"));
    await send(message("999111"));
    await send(click("description:skip"));
    await send(photo());
    const documentSent = sent.find(
      (c) => c.method === "sendDocument" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
    );
    check("the invoice document is sent to the group", !!documentSent, sent.map((c) => c.method));
    check("the text rides as its caption", String(documentSent?.params.caption ?? "").includes("999,111"), documentSent?.params.caption);

    console.log("\ngroup mode: includeInvoice off");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await send(click(`project:${mine.id}`));
    await send(click("category:MATERIALS"));
    await send(message("999222"));
    await send(click("description:skip"));
    await send(photo());
    check(
      "no document when includeInvoice is off",
      !sent.some(
        (c) => c.method === "sendDocument" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
      ),
      sent.map((c) => c.method),
    );
    check(
      "the text announcement still goes out",
      sent.some(
        (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
      ),
    );

    console.log("\ngroup mode: a forged payload is never used as a target");
    sent.length = 0;
    await send(message("/start g999888777666"));
    check(
      "a forged payload is treated as a plain start",
      texts(sent).some((t) => t.includes("خوش آمدید")),
      texts(sent),
    );
    check("no flow starts from a forged payload", !labels(sent).includes(mine.name), labels(sent));

    // A direct flow has no origin, so it goes to the linked group — the forged
    // chat above must never be picked up as the target.
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:TRANSPORT"));
    await send(message("111000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check(
      "a direct flow is announced to the linked group",
      sent.some(
        (c) =>
          c.method === "sendMessage" &&
          String(c.params.chat_id) === String(LINKED_GROUP_ID) &&
          String(c.params.text).includes("111,000"),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );
    check(
      "the forged chat never receives an announcement",
      !sent.some(
        (c) => c.method === "sendMessage" && String(c.params.chat_id) === "999888777666",
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    console.log("\ndirect flow: fanned out to every linked group when enabled");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    await send(groupMessage("/linkgroup", ADMIN_ID, UNLINKED_GROUP_ID, "گروه دوم"));
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:MATERIALS"));
    await send(message("500500"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const direct = await created(employee.id, 500_500n);
    check("the direct expense is saved", !!direct, direct);
    const groupTargets = [String(LINKED_GROUP_ID), String(UNLINKED_GROUP_ID)];
    const directGroupAnnouncements = sent.filter(
      (c) => c.method === "sendMessage" && groupTargets.includes(String(c.params.chat_id)),
    );
    eq(
      "it is announced exactly once to each linked group",
      directGroupAnnouncements.length,
      2,
    );
    check(
      "both linked groups receive it",
      groupTargets.every((g) =>
        directGroupAnnouncements.some((c) => String(c.params.chat_id) === g),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );
    const storedDirect = direct
      ? await prisma.expense.findUnique({ where: { id: direct.id } })
      : null;
    const storedChats = JSON.stringify(storedDirect?.announcedChats ?? []);
    check(
      "both chats are remembered for a later correction",
      groupTargets.every((g) => storedChats.includes(g)),
      storedDirect?.announcedChats,
    );

    console.log("\ndirect flow: the setting turns the announcement off");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: false,
    });
    await send(groupMessage("/unlinkgroup", ADMIN_ID, UNLINKED_GROUP_ID));
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("600600"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check("the direct expense is still saved", !!(await created(employee.id, 600_600n)));
    check(
      "nothing is announced while the direct setting is off",
      !sent.some(
        (c) =>
          (c.method === "sendMessage" || c.method === "sendDocument") &&
          String(c.params.chat_id) === String(LINKED_GROUP_ID),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    console.log("\ndirect flow: no linked group saves silently");
    await send(groupMessage("/unlinkgroup", ADMIN_ID, LINKED_GROUP_ID));
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("700700"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check(
      "the expense is saved with no group linked",
      !!(await created(employee.id, 700_700n)),
    );
    check(
      "the recorder is not told an announcement failed",
      !texts(sent).some((t) => t.includes("اعلام آن در گروه ناموفق")),
      texts(sent),
    );

    console.log("\ndirect flow: announceMode is honoured");
    await send(groupMessage("/linkgroup", ADMIN_ID, LINKED_GROUP_ID, "گروه شرکت"));
    await updateAnnouncementSettings({
      announceMode: "MINIMAL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("810810"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const minimalDirect = sent.find(
      (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
    );
    eq(
      "a direct MINIMAL announcement says just who and where",
      String(minimalDirect?.params.text ?? ""),
      `✅ ثبت شد: کاربر تست ربات | ${mine.name}`,
    );

    await updateAnnouncementSettings({
      announceMode: "OFF",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("820820"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check(
      "nothing is announced while OFF",
      !sent.some(
        (c) =>
          (c.method === "sendMessage" || c.method === "sendDocument") &&
          String(c.params.chat_id) === String(LINKED_GROUP_ID),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    console.log("\ndirect flow: a failed announcement never fails the expense");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    const failedDirect: Sent[] = [];
    const failDirectBot = createBot("test:token", {
      client: { fetch: stubFetch(failedDirect, { failChatIds: new Set([String(LINKED_GROUP_ID)]) }) },
    });
    await failDirectBot.init();
    const sendDirectFail = makeSend(failDirectBot, failedDirect);
    await sendDirectFail(message("/expense"));
    await sendDirectFail(click(`project:${mine.id}`));
    await sendDirectFail(click("category:OTHER"));
    await sendDirectFail(message("910910"));
    await sendDirectFail(click("description:skip"));
    await sendDirectFail(click("invoice:skip"));
    check(
      "the direct expense survives an announcement failure",
      !!(await created(employee.id, 910_910n)),
    );
    check(
      "the recorder is warned privately",
      texts(failedDirect).some((t) => t.includes("اعلام آن در گروه ناموفق")),
      texts(failedDirect),
    );


    console.log("\ngroup mode: a failed announcement never fails the expense");
    const failedSent: Sent[] = [];
    const failBot = createBot("test:token", {
      client: { fetch: stubFetch(failedSent, { failChatIds: new Set([String(LINKED_GROUP_ID)]) }) },
    });
    await failBot.init();
    const sendFail = makeSend(failBot, failedSent);
    sent.length = 0;
    await sendFail(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await sendFail(click(`project:${mine.id}`));
    await sendFail(click("category:OTHER"));
    await sendFail(message("444555"));
    await sendFail(click("description:skip"));
    await sendFail(click("invoice:skip"));
    const survived = await created(employee.id, 444_555n);
    check("the expense survives an announcement failure", !!survived, survived);
    check(
      "the user is warned privately",
      texts(failedSent).some((t) => t.includes("اعلام آن در گروه ناموفق")),
      texts(failedSent),
    );

    console.log("\ngroup mode: unlink between start and announce");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`)); // still linked here
    await send(click(`project:${mine.id}`));
    await send(click("category:OTHER"));
    await send(message("321321"));
    await send(click("description:skip"));
    await send(groupMessage("/unlinkgroup", ADMIN_ID, LINKED_GROUP_ID));
    sent.length = 0;
    await send(click("invoice:skip"));
    const unlinkedExpense = await created(employee.id, 321_321n);
    check("the expense is still saved after an unlink", !!unlinkedExpense, unlinkedExpense);
    check(
      "nothing is announced to a group unlinked before the write",
      !sent.some(
        (c) => c.method === "sendMessage" && String(c.params.chat_id) === String(LINKED_GROUP_ID),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    console.log("\nconfirmation: nothing is written before approve");
    autoConfirm = false;
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:MATERIALS"));
    await send(message("150000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check(
      "a summary is shown before saving",
      texts(sent).some(
        (t) => t.includes("پروژه:") && t.includes("مبلغ: 150,000 تومان"),
      ),
      texts(sent),
    );
    eq(
      "nothing is written while on the summary",
      await prisma.expense.count({ where: { userId: employee.id, amount: 150_000n } }),
      0,
    );
    const confirmData = dataFor(sent, "تأیید");
    check("the approve button is offered", confirmData === "confirm:approve", confirmData);
    await send(click(confirmData!));
    check(
      "approve finally writes the expense",
      !!(await created(employee.id, 150_000n)),
    );

    console.log("\nconfirmation: editing a field then approving");
    sent.length = 0;
    await send(message("/expense"));
    await send(click(`project:${mine.id}`));
    await send(click("category:TRANSPORT"));
    await send(message("100"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    check(
      "the summary shows the original amount",
      texts(sent).some((t) => t.includes("100 تومان")),
      texts(sent),
    );
    const editData = dataFor(sent, "ویرایش");
    check("the edit button is offered", editData === "confirm:edit", editData);
    await send(click(editData!));
    const fieldData = dataFor(sent, "مبلغ");
    check("edit offers the amount field", fieldData === "editfield:amount", fieldData);
    await send(click(fieldData!));
    await send(message("250000"));
    check(
      "the edited amount is reflected in the new summary",
      texts(sent).some((t) => t.includes("250,000 تومان")),
      texts(sent),
    );
    await send(click(dataFor(sent, "تأیید")!));
    const edited = await created(employee.id, 250_000n);
    check("the edited value is what is saved", !!edited, edited);
    eq("the untouched field survives the edit", edited?.category, "TRANSPORT");
    autoConfirm = true;

    console.log("\nself-cancel within the window");
    await updateAnnouncementSettings({
      announceMode: "FULL",
      includeInvoice: false,
      announceDirectExpenses: true,
    });
    await updateCancellationSettings({ windowMinutes: 15 });
    // Earlier scenarios unlinked the group; re-link it for this group flow.
    await send(groupMessage("/linkgroup", ADMIN_ID, LINKED_GROUP_ID, "گروه شرکت"));
    sent.length = 0;
    await send(message(`/start g${Math.abs(LINKED_GROUP_ID)}`));
    await send(click(`project:${mine.id}`));
    await send(click("category:TOOLS"));
    await send(message("123000"));
    await send(click("description:skip"));
    await send(click("invoice:skip"));
    const toCancel = await created(employee.id, 123_000n);
    check("the expense is saved for cancellation", !!toCancel, toCancel);
    const cancelData = dataFor(sent, "لغو این هزینه");
    check(
      "a self-cancel button rides on the saved message",
      cancelData === `selfcancel:${toCancel?.id}`,
      cancelData,
    );
    sent.length = 0;
    await send(click(cancelData!));
    check(
      "the recorder is told the expense is cancelled",
      texts(sent).some((t) => t.includes("لغو شد")),
      texts(sent),
    );
    const cancelledRow = await prisma.expense.findUnique({ where: { id: toCancel?.id } });
    check("the row is soft-deleted", !!cancelledRow?.deletedAt, cancelledRow);
    eq("deletion is attributed to the employee", cancelledRow?.deletedByType, "EMPLOYEE");
    check(
      "an audit CANCEL row exists",
      (await prisma.expenseAuditLog.count({
        where: { expenseId: toCancel?.id, action: "CANCEL" },
      })) === 1,
    );
    check(
      "a cancellation notice reaches the group",
      sent.some(
        (c) =>
          c.method === "sendMessage" &&
          String(c.params.chat_id) === String(LINKED_GROUP_ID) &&
          String(c.params.text).includes("لغو شد"),
      ),
      sent.map((c) => `${c.method}:${String(c.params.chat_id)}`),
    );

    console.log("\nself-cancel is limited to the recorder");
    const owned = await prisma.expense.create({
      data: {
        projectId: mine.id,
        userId: employee.id,
        category: "OTHER",
        amount: 55_000n,
        invoiceNumber: "invoice_ctl1",
        expenseDate: new Date(),
      },
    });
    autoConfirm = false;
    sent.length = 0;
    await send(click(`selfcancel:${owned.id}`, ADMIN_ID));
    check(
      "a non-owner is refused",
      texts(sent).some((t) => t.includes("فقط می‌توانید هزینه‌ای را که خودتان ثبت کرده‌اید")),
      texts(sent),
    );
    check(
      "the row is untouched by a non-owner",
      (await prisma.expense.findUnique({ where: { id: owned.id } }))?.deletedAt === null,
    );

    console.log("\nself-cancel after the window");
    const stale = await prisma.expense.create({
      data: {
        projectId: mine.id,
        userId: employee.id,
        category: "OTHER",
        amount: 66_000n,
        invoiceNumber: "invoice_ctl2",
        expenseDate: new Date(),
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    sent.length = 0;
    await send(click(`selfcancel:${stale.id}`));
    check(
      "an expired window is refused",
      texts(sent).some((t) => t.includes("مهلت")),
      texts(sent),
    );
    check(
      "the stale row is not cancelled",
      (await prisma.expense.findUnique({ where: { id: stale.id } }))?.deletedAt === null,
    );

    console.log("\nself-cancel when the window is disabled");
    await updateCancellationSettings({ windowMinutes: 0 });
    const blocked = await prisma.expense.create({
      data: {
        projectId: mine.id,
        userId: employee.id,
        category: "OTHER",
        amount: 77_000n,
        invoiceNumber: "invoice_ctl3",
        expenseDate: new Date(),
      },
    });
    sent.length = 0;
    await send(click(`selfcancel:${blocked.id}`));
    check(
      "disabled self-cancel is refused",
      texts(sent).some((t) => t.includes("غیرفعال")),
      texts(sent),
    );
  } finally {
    globalThis.fetch = realFetch;

    const userIds = [
      employee.id,
      loneless.id,
      admin.id,
      disabled.id,
      ...(approvedUserId ? [approvedUserId] : []),
    ];

    // Collect first, then delete, so nothing can slip past the cleanup.
    const rows = await prisma.expense.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, invoiceFilePath: true },
    });
    await prisma.expense.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    // The links cascade with the users; the project itself has to go too.
    await prisma.project.deleteMany({ where: { id: closedProject.id } });

    await prisma.accessRequest.deleteMany({
      where: { externalId: { startsWith: "999000" } },
    });
    await prisma.linkedChat.deleteMany({ where: { channel: "telegram" } });
    // Leave the announcement and cancellation settings at their built-in defaults.
    await prisma.setting.deleteMany({ where: { key: { in: ["announcement", "cancellation"] } } });

    for (const row of rows) {
      if (!row.invoiceFilePath) continue;
      const full = path.resolve(process.cwd(), config.uploadDir, row.invoiceFilePath);
      await rm(full, { force: true });
      check(
        `invoice ${row.invoiceFilePath} removed`,
        (await stat(full).catch(() => null)) === null,
      );
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("test bot crashed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
