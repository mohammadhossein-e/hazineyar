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
import "dotenv/config";
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
let updateId = 0;

type Sent = { method: string; params: Record<string, unknown> };
type Markup = { inline_keyboard?: { text: string; callback_data: string }[][] };

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
function stubFetch(sent: Sent[]): typeof fetch {
  const json = (result: unknown) =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/file/bot")) {
      return fileResponse();
    }

    const method = url.slice(url.lastIndexOf("/") + 1);
    const params = init?.body ? JSON.parse(String(init.body)) : {};
    sent.push({ method, params });

    switch (method) {
      case "sendMessage":
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

function photo(from = EMPLOYEE_ID) {
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

const texts = (sent: Sent[]) =>
  sent.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text ?? ""));

/** The file ids `getFile` was asked for, in order. */
const fetched = (sent: Sent[]) =>
  sent.filter((c) => c.method === "getFile").map((c) => String(c.params.file_id));

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
  const send = (update: unknown) => bot.handleUpdate(update as never);

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
      "told to contact the admin",
      texts(sent).some((t) => t.includes("ثبت نشده")),
      texts(sent),
    );
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
    await send(photo());
    eq("the dropped photo writes nothing", await prisma.expense.count({ where: { userId: employee.id } }), before);
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
    await send(message("/expense", 999_000_444));
    for (const p of projects) {
      check(`admin is offered ${p.name}`, labels(sent).includes(p.name));
    }
    await send(click("flow:cancel"));
  } finally {
    globalThis.fetch = realFetch;

    const userIds = [employee.id, loneless.id, admin.id, disabled.id];

    // Collect first, then delete, so nothing can slip past the cleanup.
    const rows = await prisma.expense.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, invoiceFilePath: true },
    });
    await prisma.expense.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    // The links cascade with the users; the project itself has to go too.
    await prisma.project.deleteMany({ where: { id: closedProject.id } });

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
