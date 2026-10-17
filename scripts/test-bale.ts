/**
 * Offline end-to-end check for the Bale adapter.
 *
 * The bot talks to a stubbed Bale Bot API (the same wire protocol as Telegram),
 * so this runs without a token and without network access. It pins down the
 * three things that actually differ on Bale:
 *
 *   1. requests go to the configured `BALE_API_BASE`, not api.telegram.org;
 *   2. every callback query is acknowledged *before* any handler runs, and a
 *      rejected (stale/expired) answer does not break the flow;
 *   3. group features are off — `/linkgroup` is not even registered.
 *
 * Usage:
 *   npm run test:bale             (or: npx tsx scripts/test-bale.ts)
 */
import "./test-env";

import { prisma } from "../src/lib/db";
import { config } from "../src/lib/config";
import { redactText } from "../src/lib/redact";
import { createBaleBot } from "../src/adapters/bale";
import { BALE_CHANNEL } from "../src/adapters/channel";
import { CALLBACK } from "../src/adapters/keys";

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

type Sent = { method: string; params: Record<string, unknown>; url: string };

/**
 * A stub for grammy's transport. `getMe` answers with a bot identity; every
 * other method is recorded so the tests can inspect order and payloads. When
 * `failCallbackAck` is set, `answerCallbackQuery` is rejected the way Bale
 * rejects a stale query, which the bot must swallow.
 */
function stubFetch(
  sent: Sent[],
  options: { failCallbackAck?: boolean } = {},
): typeof fetch {
  const ok = (result: unknown) =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf("/") + 1);
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    const params = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    sent.push({ method, params, url });

    if (method === "answerCallbackQuery" && options.failCallbackAck) {
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "query is too old",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    if (method === "getMe") {
      return ok({
        id: 7,
        is_bot: true,
        first_name: "Bale",
        username: "hazineyar_bale_bot",
      });
    }
    return ok({ message_id: 1, date: 0, chat: { id: params.chat_id, type: "private" } });
  }) as typeof fetch;
}

const texts = (sent: Sent[]) =>
  sent.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text ?? ""));

const methods = (sent: Sent[]) => sent.map((c) => c.method);

let updateId = 0;
const now = () => Math.floor(Date.now() / 1000);
const user = (id: number, username?: string) => ({
  id,
  is_bot: false,
  first_name: "تست",
  ...(username ? { username } : {}),
});
const chat = (id: number) => ({ id, type: "private" as const, first_name: "تست" });

function message(text: string, from = EMPLOYEE_ID) {
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
      ...(isCommand ? { entities: [{ type: "bot_command", offset: 0, length }] } : {}),
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

function groupMessage(text: string, from = EMPLOYEE_ID, chatId = GROUP_ID) {
  const isCommand = text.startsWith("/");
  const length = isCommand ? text.split(/\s/)[0].length : 0;
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: now(),
      chat: { id: chatId, type: "supergroup" as const, title: "گروه شرکت" },
      from: user(from),
      text,
      ...(isCommand ? { entities: [{ type: "bot_command", offset: 0, length }] } : {}),
    },
  };
}

const EMPLOYEE_ID = 999_100_111;
const UNKNOWN_ID = 999_100_555;
const GROUP_ID = -100_888_000_111;

async function main() {
  console.log("bale adapter\n");

  console.log("channel configuration");
  check("groups are disabled", BALE_CHANNEL.supportsGroups === false);
  check("callbacks are acked globally", BALE_CHANNEL.ackCallbacksGlobally === true);
  check("api root has no trailing slash", !BALE_CHANNEL.apiRoot?.endsWith("/"));

  console.log("\ntoken redaction");
  const secret = "123456:AAF-secret-token-value";
  const redacted = redactText(`https://tapi.bale.ai/bot${secret}/getMe`, [secret]);
  check("the token is masked in a URL", !redacted.includes(secret), redacted);
  check("the mask is inserted", redacted.includes("«token»"), redacted);

  const employee = await prisma.user.create({
    data: {
      name: "کارمند بله",
      channel: "bale",
      externalId: String(EMPLOYEE_ID),
      role: "EMPLOYEE",
    },
  });
  const project = await prisma.project.create({
    data: {
      name: "پروژه بله",
      userProjects: { create: [{ userId: employee.id }] },
    },
  });

  const sent: Sent[] = [];
  const bot = createBaleBot("test:token", { client: { fetch: stubFetch(sent) } });

  await bot.init();
  sent.length = 0;

  try {
    console.log("\nunregistered user requests access on Bale");
    await bot.handleUpdate(message("/start", UNKNOWN_ID) as never);
    check(
      "the request is acknowledged in Persian",
      texts(sent).some((t) => t.includes("درخواست دسترسی")),
      texts(sent),
    );
    const request = await prisma.accessRequest.findUnique({
      where: { channel_externalId: { channel: "bale", externalId: String(UNKNOWN_ID) } },
    });
    check("the request is recorded for the bale channel", request?.channel === "bale", request);
    check("the display name is captured", request?.displayName === "تست", request?.displayName);

    console.log("\nthe bot talks to the Bale host");
    sent.length = 0;
    await bot.handleUpdate(message("/start") as never);
    check(
      "getMe goes to BALE_API_BASE",
      sent.some((c) => c.url.startsWith(config.baleApiBase)),
      sent.map((c) => c.url),
    );

    console.log("\ncallbacks are acknowledged before the handler runs");
    sent.length = 0;
    await bot.handleUpdate(click(CALLBACK.retry) as never);
    const order = methods(sent);
    check(
      "the first call is answerCallbackQuery",
      order[0] === "answerCallbackQuery",
      order,
    );
    check(
      "a reply still follows the ack",
      order.indexOf("sendMessage") > order.indexOf("answerCallbackQuery"),
      order,
    );

    console.log("\na stale/expired ack does not break the flow");
    const stale: Sent[] = [];
    const staleBot = createBaleBot("test:token", {
      client: { fetch: stubFetch(stale, { failCallbackAck: true }) },
    });
    await staleBot.init();
    stale.length = 0;
    await staleBot.handleUpdate(click(CALLBACK.retry) as never);
    check(
      "the rejected ack is swallowed and the flow still replies",
      methods(stale).includes("sendMessage"),
      methods(stale),
    );

    console.log("\ngroup commands are not offered on Bale");
    sent.length = 0;
    await bot.handleUpdate(groupMessage("/linkgroup", EMPLOYEE_ID) as never);
    check(
      "an unregistered group command produces no reply",
      texts(sent).length === 0,
      texts(sent),
    );
  } finally {
    await prisma.expense.deleteMany({ where: { userId: employee.id } });
    await prisma.user.deleteMany({ where: { id: employee.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await prisma.accessRequest.deleteMany({
      where: { channel: "bale", externalId: { startsWith: "999100" } },
    });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("test bale crashed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
