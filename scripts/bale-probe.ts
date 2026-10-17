/**
 * Phase 1 probe for the Bale Bot API.
 *
 * The point of this script is to learn what the Bale Bot API actually supports
 * before any adapter is written, so the adapter is built on facts rather than on
 * "Bale mirrors Telegram" assumptions. It talks to the live API using the token
 * from BALE_BOT_TOKEN only; the token is never printed (every payload is run
 * through `redact` first) and it never touches the database.
 *
 * Group scope is deliberately out of reach for now: Bale hides bots with fewer
 * than 20 users from search and the profile has no "add to group" action, so
 * every group-looking capability is reported as SKIPPED. See `GROUP_SKIPPED`.
 *
 * Usage:
 *   npx tsx scripts/bale-probe.ts auto       # run all non-interactive checks
 *   npx tsx scripts/bale-probe.ts prompts    # send the interactive prompts
 *   npx tsx scripts/bale-probe.ts collect    # read back what the user did
 *   npx tsx scripts/bale-probe.ts report     # print the consolidated report
 *
 * `auto` drains getUpdates and stores the next offset; `prompts`/`collect` pick
 * up from there. State lives in the OS temp dir so nothing lands in the repo.
 */
import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "../src/lib/redact";

const TOKEN = (process.env.BALE_BOT_TOKEN ?? "").trim();
if (!TOKEN) {
  console.error("FATAL: BALE_BOT_TOKEN is not set (put it in .env).");
  process.exit(1);
}

const BASE = (process.env.BALE_API_BASE ?? "https://tapi.bale.ai").replace(
  /\/+$/,
  "",
);
const API = `${BASE}/bot${TOKEN}`;
/** The owner's private chat, taken from the /start already in getUpdates. */
const CHAT_ID = (process.env.BALE_PROBE_CHAT_ID ?? "1423634928").trim();
const DEEP_LINK_PAYLOAD = "BALEPROBE1";
const STATE_PATH = join(tmpdir(), "bale-probe-state.json");

/**
 * Nothing that leaves this process may contain the token. Delegates to the
 * shared redactor so the probe and the running bot cannot drift apart on what
 * counts as a secret.
 */
function redact(value: string): string {
  return redactText(value, [TOKEN]);
}

type Check = {
  group: "private" | "group";
  name: string;
  status: "OK" | "FAIL" | "SKIPPED";
  detail?: unknown;
};

type State = {
  offset?: number;
  checks: Check[];
  profile?: { id?: number; username?: string; firstName?: string };
  deepLink?: string;
  promptsSent?: boolean;
};

type ApiResult = {
  httpStatus: number;
  ok: boolean;
  result: any;
  description?: string;
  errorCode?: number;
  raw: string;
};

async function api(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<ApiResult> {
  try {
    const response = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Non-JSON body (usually an HTML error page) — keep the raw text.
    }
    return {
      httpStatus: response.status,
      ok: !!parsed?.ok,
      result: parsed?.result,
      description: parsed?.description,
      errorCode: parsed?.error_code,
      raw: redact(raw).slice(0, 500),
    };
  } catch (error) {
    return {
      httpStatus: 0,
      ok: false,
      result: null,
      description: redact(String(error)),
      raw: redact(String(error)),
    };
  }
}

async function apiMultipart(
  method: string,
  fields: Record<string, string>,
  fileField: string,
  file: { name: string; type: string; buffer: Buffer },
): Promise<ApiResult> {
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(
      fileField,
      new Blob([new Uint8Array(file.buffer)], { type: file.type }),
      file.name,
    );
    const response = await fetch(`${API}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw
    }
    return {
      httpStatus: response.status,
      ok: !!parsed?.ok,
      result: parsed?.result,
      description: parsed?.description,
      errorCode: parsed?.error_code,
      raw: redact(raw).slice(0, 500),
    };
  } catch (error) {
    return {
      httpStatus: 0,
      ok: false,
      result: null,
      description: redact(String(error)),
      raw: redact(String(error)),
    };
  }
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as State;
  } catch {
    return { checks: [] };
  }
}

async function saveState(state: State): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function push(state: State, check: Check): void {
  state.checks.push(check);
  const mark =
    check.status === "OK" ? "ok  " : check.status === "FAIL" ? "FAIL" : "SKIP";
  const detail =
    check.detail === undefined ? "" : " :: " + JSON.stringify(check.detail);
  console.log(`  ${mark} [${check.group}] ${check.name}${detail}`);
}

/**
 * A 1x1 RGBA PNG — enough to prove photo upload/download without shipping an
 * asset. It is deliberately colour type 6 (RGBA): the first probe attempt used
 * a grayscale+alpha PNG (colour type 4) and Bale answered `UNSUPPORTED_FILE`,
 * so the probe pins the accepted colour types.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A tiny but structurally valid PDF for the document path. */
const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Size 4/Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

const GROUP_SKIPPED: Array<[string, string]> = [
  ["group commands (/linkgroup, /unlinkgroup)", "no way to add the bot to a group yet"],
  ["group message visibility", "no way to add the bot to a group yet"],
  ["group chat types in updates", "no way to add the bot to a group yet"],
  ["my_chat_member events", "no way to add the bot to a group yet"],
  ["deep link opened from a group", "no way to add the bot to a group yet"],
  ["group announcements / send to a group", "no way to add the bot to a group yet"],
];

function skipGroups(state: State): void {
  for (const [name, reason] of GROUP_SKIPPED) {
    push(state, {
      group: "group",
      name,
      status: "SKIPPED",
      detail: `SKIPPED (no group access) — ${reason}`,
    });
  }
}

/** Tries one callback_data length; returns whether the send was accepted. */
async function tryCallbackLength(
  length: number,
): Promise<{ ok: boolean; description?: string }> {
  const data = "x".repeat(length);
  const sent = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: `probe: callback_data ${length} chars`,
    reply_markup: {
      inline_keyboard: [[{ text: "probe", callback_data: data }]],
    },
    disable_notification: true,
  });
  if (sent.ok && sent.result?.message_id) {
    await api("deleteMessage", {
      chat_id: CHAT_ID,
      message_id: sent.result.message_id,
    });
  }
  return { ok: sent.ok, description: sent.description };
}

async function auto(): Promise<void> {
  const state: State = await loadState();
  state.checks = [];
  console.log("\nBale Bot API probe — automatic checks\n");

  // -- identity ----------------------------------------------------------
  const me = await api("getMe");
  state.profile = {
    id: me.result?.id,
    username: me.result?.username,
    firstName: me.result?.first_name,
  };
  push(state, {
    group: "private",
    name: "getMe",
    status: me.ok ? "OK" : "FAIL",
    detail: me.ok
      ? { id: me.result.id, username: me.result.username, is_bot: me.result.is_bot }
      : { httpStatus: me.httpStatus, description: me.description },
  });

  // -- polling / offset --------------------------------------------------
  const first = await api("getUpdates", { timeout: 0, limit: 100 });
  const updates: any[] = Array.isArray(first.result) ? first.result : [];
  const maxId = updates.reduce((m, u) => Math.max(m, u.update_id ?? 0), 0);
  push(state, {
    group: "private",
    name: "getUpdates returns an array",
    status: first.ok && Array.isArray(first.result) ? "OK" : "FAIL",
    detail: first.ok
      ? { count: updates.length, updateIds: updates.map((u) => u.update_id) }
      : { httpStatus: first.httpStatus, description: first.description },
  });

  // Confirm offset semantics: requesting past the last id should settle empty.
  const drained = await api("getUpdates", { offset: maxId + 1, timeout: 0 });
  push(state, {
    group: "private",
    name: "offset past the last update settles the queue",
    status: drained.ok && Array.isArray(drained.result) && drained.result.length === 0
      ? "OK"
      : "FAIL",
    detail: { returned: drained.result?.length ?? null },
  });
  state.offset = maxId + 1;

  // Blocking long-poll: timeout=1 should hold the connection for ~1s.
  const t0 = Date.now();
  await api("getUpdates", { offset: state.offset, timeout: 1 }, 10_000);
  const waited = Date.now() - t0;
  push(state, {
    group: "private",
    name: "long polling (timeout=1) blocks instead of returning immediately",
    status: waited >= 700 ? "OK" : "FAIL",
    detail: { waitedMs: waited },
  });

  // -- sendMessage -------------------------------------------------------
  const hello = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: "پروب بله: پیام آزمایشی",
    disable_notification: true,
  });
  push(state, {
    group: "private",
    name: "sendMessage",
    status: hello.ok ? "OK" : "FAIL",
    detail: hello.ok
      ? { message_id: hello.result?.message_id, chat_type: hello.result?.chat?.type }
      : { httpStatus: hello.httpStatus, description: hello.description },
  });
  const helloId = hello.result?.message_id as number | undefined;

  const html = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: "<b>پروب</b> <i>HTML</i>",
    parse_mode: "HTML",
    disable_notification: true,
  });
  push(state, {
    group: "private",
    name: "sendMessage parse_mode=HTML",
    status: html.ok ? "OK" : "FAIL",
    detail: html.ok ? undefined : { description: html.description, code: html.errorCode },
  });

  const md = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: "*پروب* _Markdown_",
    parse_mode: "Markdown",
    disable_notification: true,
  });
  push(state, {
    group: "private",
    name: "sendMessage parse_mode=Markdown",
    status: md.ok ? "OK" : "FAIL",
    detail: md.ok ? undefined : { description: md.description, code: md.errorCode },
  });

  const action = await api("sendChatAction", {
    chat_id: CHAT_ID,
    action: "typing",
  });
  push(state, {
    group: "private",
    name: "sendChatAction (typing)",
    status: action.ok ? "OK" : "FAIL",
    detail: action.ok ? undefined : { description: action.description },
  });

  // -- inline keyboard + callback_data limit ----------------------------
  const keyboard = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: "پروب بله: پیام با دکمه شیشه‌ای",
    reply_markup: {
      inline_keyboard: [[{ text: "دکمه", callback_data: "probe:button" }]],
    },
    disable_notification: true,
  });
  push(state, {
    group: "private",
    name: "sendMessage with an inline_keyboard",
    status: keyboard.ok ? "OK" : "FAIL",
    detail: keyboard.ok
      ? { message_id: keyboard.result?.message_id }
      : { description: keyboard.description },
  });
  if (keyboard.ok && keyboard.result?.message_id) {
    await api("deleteMessage", {
      chat_id: CHAT_ID,
      message_id: keyboard.result.message_id,
    });
  }

  const lengths = [8, 32, 64, 65, 100, 128, 200, 256, 512, 1024];
  const accepted: number[] = [];
  let firstRejected: { length: number; description?: string } | null = null;
  for (const length of lengths) {
    const r = await tryCallbackLength(length);
    if (r.ok) accepted.push(length);
    else if (!firstRejected) firstRejected = { length, description: r.description };
  }
  push(state, {
    group: "private",
    name: "callback_data length: largest accepted",
    status: accepted.length ? "OK" : "FAIL",
    detail: {
      accepted,
      firstRejected,
      observedLimit: firstRejected ? firstRejected.length - 1 : accepted.at(-1),
    },
  });

  // -- editMessageText / deleteMessage ----------------------------------
  if (helloId) {
    const edited = await api("editMessageText", {
      chat_id: CHAT_ID,
      message_id: helloId,
      text: "پروب بله: پیام ویرایش‌شده",
    });
    push(state, {
      group: "private",
      name: "editMessageText",
      status: edited.ok ? "OK" : "FAIL",
      detail: edited.ok
        ? { text: edited.result?.text }
        : { description: edited.description, code: edited.errorCode },
    });

    const removed = await api("deleteMessage", {
      chat_id: CHAT_ID,
      message_id: helloId,
    });
    push(state, {
      group: "private",
      name: "deleteMessage (own message)",
      status: removed.ok ? "OK" : "FAIL",
      detail: removed.ok ? { deleted: removed.result } : { description: removed.description },
    });
  }

  // A bogus message id tells us whether the method exists (wrong-id error)
  // versus being unsupported (method-not-found error).
  const editMissing = await api("editMessageText", {
    chat_id: CHAT_ID,
    message_id: 999999999,
    text: "x",
  });
  push(state, {
    group: "private",
    name: "editMessageText on an unknown id (method-exists signal)",
    status: editMissing.ok ? "FAIL" : "OK",
    detail: { description: editMissing.description, code: editMissing.errorCode },
  });

  // -- photo send + getFile + download ----------------------------------
  const photo = await apiMultipart(
    "sendPhoto",
    { chat_id: CHAT_ID, caption: "پروب بله: عکس", disable_notification: "true" },
    "photo",
    { name: "probe.png", type: "image/png", buffer: PNG_1X1 },
  );
  const photoFileId = photo.result?.photo?.at?.(-1)?.file_id as string | undefined;
  push(state, {
    group: "private",
    name: "sendPhoto with a caption (multipart upload)",
    status: photo.ok ? "OK" : "FAIL",
    detail: photo.ok
      ? {
          message_id: photo.result?.message_id,
          photoSizes: photo.result?.photo?.length,
          hasFileId: !!photoFileId,
          caption: photo.result?.caption,
        }
      : { httpStatus: photo.httpStatus, description: photo.description },
  });
  if (photoFileId) {
    const got = await api("getFile", { file_id: photoFileId });
    push(state, {
      group: "private",
      name: "getFile for a sent photo",
      status: got.ok && got.result?.file_path ? "OK" : "FAIL",
      detail: got.ok
        ? { file_path: got.result.file_path, file_size: got.result.file_size }
        : { description: got.description },
    });
    if (got.result?.file_path) {
      const dl = await fetch(
        `${BASE}/file/bot${TOKEN}/${got.result.file_path}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const bytes = Buffer.from(await dl.arrayBuffer());
      push(state, {
        group: "private",
        name: "download the photo file",
        status: dl.ok && bytes.byteLength > 0 ? "OK" : "FAIL",
        detail: { httpStatus: dl.status, bytes: bytes.byteLength },
      });
    }

    const resend = await api("sendPhoto", {
      chat_id: CHAT_ID,
      photo: photoFileId,
      disable_notification: true,
    });
    if (resend.ok && resend.result?.message_id) {
      await api("deleteMessage", {
        chat_id: CHAT_ID,
        message_id: resend.result.message_id,
      });
    }
    push(state, {
      group: "private",
      name: "sendPhoto by file_id (no re-upload)",
      status: resend.ok ? "OK" : "FAIL",
      detail: resend.ok ? undefined : { description: resend.description },
    });
  }

  // Bale's photo path sniffs the pixel format: a grayscale+alpha PNG is
  // rejected outright, which matters if an invoice arrives as a PNG.
  const grayPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const gray = await apiMultipart(
    "sendPhoto",
    { chat_id: CHAT_ID, disable_notification: "true" },
    "photo",
    { name: "probe-gray.png", type: "image/png", buffer: grayPng },
  );
  push(state, {
    group: "private",
    name: "sendPhoto colour-type sensitivity",
    status: "OK",
    detail: {
      rgbaAccepted: photo.ok,
      grayscaleAlphaAccepted: gray.ok,
      grayscaleError: gray.ok ? null : gray.description,
      note: "Bale rejects colour-type-4 PNGs (UNSUPPORTED_FILE); JPEG/RGBA PNG are fine",
    },
  });

  // -- document send + getFile + download -------------------------------
  const doc = await apiMultipart(
    "sendDocument",
    { chat_id: CHAT_ID, caption: "پروب بله: سند", disable_notification: "true" },
    "document",
    { name: "probe.pdf", type: "application/pdf", buffer: TINY_PDF },
  );
  const docFileId = doc.result?.document?.file_id as string | undefined;
  push(state, {
    group: "private",
    name: "sendDocument with a caption (multipart upload)",
    status: doc.ok ? "OK" : "FAIL",
    detail: doc.ok
      ? {
          message_id: doc.result?.message_id,
          file_name: doc.result?.document?.file_name,
          mime_type: doc.result?.document?.mime_type,
          hasFileId: !!docFileId,
        }
      : { httpStatus: doc.httpStatus, description: doc.description },
  });
  if (docFileId) {
    const got = await api("getFile", { file_id: docFileId });
    push(state, {
      group: "private",
      name: "getFile for a sent document",
      status: got.ok && got.result?.file_path ? "OK" : "FAIL",
      detail: got.ok ? { file_path: got.result.file_path } : { description: got.description },
    });
  }

  // -- answerCallbackQuery existence ------------------------------------
  const ack = await api("answerCallbackQuery", {
    callback_query_id: "does-not-exist",
    text: "x",
  });
  push(state, {
    group: "private",
    name: "answerCallbackQuery (method-exists signal)",
    status: ack.ok ? "FAIL" : "OK",
    detail: { description: ack.description, code: ack.errorCode },
  });

  // -- deep link format --------------------------------------------------
  const username = state.profile?.username ?? "<username>";
  state.deepLink = `https://ble.ir/${username}?start=${DEEP_LINK_PAYLOAD}`;
  push(state, {
    group: "private",
    name: "deep-link format to open the private chat",
    status: "OK",
    detail: {
      plain: `https://ble.ir/${username}`,
      withPayload: state.deepLink,
      note: "delivery is verified in the collect stage after you open it",
    },
  });

  skipGroups(state);
  await saveState(state);
  console.log(
    "\nAutomatic checks done. Next: `npx tsx scripts/bale-probe.ts prompts`.",
  );
}

async function prompts(): Promise<void> {
  const state = await loadState();
  console.log("\nSending interactive prompts to the private chat…\n");

  const username = state.profile?.username ?? "hazineyar_bot";
  const deepLink = `https://ble.ir/${username}?start=${DEEP_LINK_PAYLOAD}`;

  await api("sendMessage", {
    chat_id: CHAT_ID,
    text:
      "پروب مرحله ۱ — لطفاً این سه کار را در همین چت خصوصی انجام دهید:\n" +
      "۱) روی دکمه زیر ضربه بزنید.\n" +
      "۲) یک عکس و سپس یک فایل PDF برای ربات بفرستید.\n" +
      "۳) لینک زیر را در بله باز کنید (روی آن بزنید).\n" +
      deepLink,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "ضربه آزمایشی",
            callback_data: "probe:tap:" + "0123456789".repeat(5),
          },
        ],
      ],
    },
    disable_notification: false,
  });

  push(state, {
    group: "private",
    name: "interactive prompts sent",
    status: "OK",
    detail: { deepLink, tapPayloadLength: 61 },
  });
  state.promptsSent = true;
  await saveState(state);
  console.log(
    "Prompts sent. Do the three steps in Bale, then run:\n" +
      "  npx tsx scripts/bale-probe.ts collect",
  );
}

async function collect(): Promise<void> {
  const state = await loadState();
  console.log("\nCollecting interactive results…\n");

  const res = await api("getUpdates", {
    offset: state.offset,
    timeout: 0,
    limit: 100,
  });
  const updates: any[] = Array.isArray(res.result) ? res.result : [];
  push(state, {
    group: "private",
    name: "getUpdates after the prompts",
    status: res.ok ? "OK" : "FAIL",
    detail: { count: updates.length, updateIds: updates.map((u) => u.update_id) },
  });

  let maxId = state.offset ? state.offset - 1 : 0;
  for (const update of updates) {
    maxId = Math.max(maxId, update.update_id ?? 0);

    if (update.callback_query) {
      const cq = update.callback_query;
      push(state, {
        group: "private",
        name: "callback_query received from a button tap",
        status: "OK",
        detail: {
          id: cq.id,
          data: cq.data,
          dataLength: typeof cq.data === "string" ? cq.data.length : null,
          chatType: cq.message?.chat?.type,
          fromId: cq.from?.id,
        },
      });
      const ack = await api("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "دریافت شد",
      });
      push(state, {
        group: "private",
        name: "answerCallbackQuery with a real id",
        status: ack.ok ? "OK" : "FAIL",
        detail: ack.ok ? { answered: ack.result } : { description: ack.description },
      });
      continue;
    }

    const message = update.message;
    if (!message) {
      push(state, {
        group: "private",
        name: "unrecognised update type",
        status: "OK",
        detail: { keys: Object.keys(update) },
      });
      continue;
    }

    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      push(state, {
        group: "private",
        name: "photo received in a private message",
        status: "OK",
        detail: {
          chatType: message.chat?.type,
          fromId: message.from?.id,
          sizes: message.photo.length,
          fileId: largest?.file_id,
          caption: message.caption,
        },
      });
      const got = await api("getFile", { file_id: largest.file_id });
      if (got.ok && got.result?.file_path) {
        const dl = await fetch(
          `${BASE}/file/bot${TOKEN}/${got.result.file_path}`,
          { signal: AbortSignal.timeout(30_000) },
        );
        const bytes = Buffer.from(await dl.arrayBuffer());
        push(state, {
          group: "private",
          name: "download a photo the user sent",
          status: dl.ok && bytes.byteLength > 0 ? "OK" : "FAIL",
          detail: { file_path: got.result.file_path, bytes: bytes.byteLength },
        });
      } else {
        push(state, {
          group: "private",
          name: "getFile for the user's photo",
          status: "FAIL",
          detail: { description: got.description },
        });
      }
      continue;
    }

    if (message.document) {
      const document = message.document;
      push(state, {
        group: "private",
        name: "document received in a private message",
        status: "OK",
        detail: {
          chatType: message.chat?.type,
          fromId: message.from?.id,
          file_name: document.file_name,
          mime_type: document.mime_type,
          file_size: document.file_size,
          fileId: document.file_id,
          caption: message.caption,
        },
      });
      const got = await api("getFile", { file_id: document.file_id });
      if (got.ok && got.result?.file_path) {
        const dl = await fetch(
          `${BASE}/file/bot${TOKEN}/${got.result.file_path}`,
          { signal: AbortSignal.timeout(30_000) },
        );
        const bytes = Buffer.from(await dl.arrayBuffer());
        push(state, {
          group: "private",
          name: "download a document the user sent",
          status: dl.ok && bytes.byteLength > 0 ? "OK" : "FAIL",
          detail: { file_path: got.result.file_path, bytes: bytes.byteLength },
        });
      } else {
        push(state, {
          group: "private",
          name: "getFile for the user's document",
          status: "FAIL",
          detail: { description: got.description },
        });
      }
      continue;
    }

    if (typeof message.text === "string") {
      const isStart = message.text.startsWith("/start");
      push(state, {
        group: "private",
        name: isStart ? "command received in the private chat" : "text message received",
        status: "OK",
        detail: {
          text: message.text,
          chatType: message.chat?.type,
          entities: message.entities,
          hasStartPayload: isStart && message.text.trim().length > "/start".length,
        },
      });
      continue;
    }

    push(state, {
      group: "private",
      name: "other message type",
      status: "OK",
      detail: { keys: Object.keys(message) },
    });
  }

  state.offset = maxId + 1;
  await saveState(state);
  console.log("\nCollected. Next: `npx tsx scripts/bale-probe.ts report`.");
}

/**
 * A short-lived poller that answers callback queries the instant they arrive, so
 * the answerCallbackQuery round-trip is measured inside Bale's expiry window
 * instead of minutes later. It sends one button and waits up to
 * BALE_PROBE_SECONDS (default 180) for a tap, then writes a small JSON log.
 */
async function listen(): Promise<void> {
  const state = await loadState();
  const seconds = Number(process.env.BALE_PROBE_SECONDS ?? "180");
  const logPath = join(tmpdir(), "bale-fastanswer.json");
  const results: any[] = [];

  let offset = state.offset ?? 0;
  const button = await api("sendMessage", {
    chat_id: CHAT_ID,
    text: "یک ضربه دیگر: روی دکمه زیر بزنید تا پاسخ فوری سنجیده شود.",
    reply_markup: {
      inline_keyboard: [[{ text: "تایید فوری", callback_data: "probe:fast" }]],
    },
    disable_notification: false,
  });
  console.log(
    button.ok
      ? "Button sent; waiting for a tap (up to %ss)…"
      : `Could not send the button: ${button.description}`,
    seconds,
  );

  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const res = await api(
      "getUpdates",
      { offset, timeout: 5, limit: 50 },
      15_000,
    );
    const updates: any[] = Array.isArray(res.result) ? res.result : [];
    for (const update of updates) {
      offset = Math.max(offset, (update.update_id ?? 0) + 1);
      if (!update.callback_query) continue;
      const cq = update.callback_query;
      const started = Date.now();
      const ack = await api("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "دریافت شد",
      });
      const latencyMs = Date.now() - started;
      const record = {
        answered: ack.ok,
        latencyMs,
        data: cq.data,
        dataLength: typeof cq.data === "string" ? cq.data.length : null,
        editInPlace: null as null | { ok: boolean; description?: string },
        description: ack.description,
      };
      if (cq.message?.message_id) {
        const edit = await api("editMessageText", {
          chat_id: cq.message.chat?.id ?? CHAT_ID,
          message_id: cq.message.message_id,
          text: "پروب: پس از ضربه ویرایش شد ✅",
        });
        record.editInPlace = { ok: edit.ok, description: edit.description };
      }
      results.push(record);
      console.log(
        ack.ok
          ? `  ok   answerCallbackQuery in ${latencyMs}ms (data len ${record.dataLength})`
          : `  FAIL answerCallbackQuery: ${ack.description}`,
      );
      await writeFile(logPath, JSON.stringify(results, null, 2), "utf8");
      state.offset = offset;
      await saveState(state);
      console.log(`  log: ${logPath}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("Timed out with no tap.");
  await writeFile(logPath, JSON.stringify(results, null, 2), "utf8");
}

async function report(): Promise<void> {
  const state = await loadState();
  console.log("\n================ Bale phase 1 report ================\n");
  if (state.profile) {
    console.log(
      `bot: @${state.profile.username} (id ${state.profile.id}, first_name ${state.profile.firstName})`,
    );
  }
  if (state.deepLink) console.log(`deep link: ${state.deepLink}`);
  console.log("");

  const groups: Array<[Check["group"], string]> = [
    ["private", "PRIVATE CHAT (in scope)"],
    ["group", "GROUP (out of scope)"],
  ];
  for (const [group, title] of groups) {
    console.log(`-- ${title} --`);
    for (const check of state.checks.filter((c) => c.group === group)) {
      const mark =
        check.status === "OK" ? "ok  " : check.status === "FAIL" ? "FAIL" : "SKIP";
      const detail =
        check.detail === undefined ? "" : " :: " + JSON.stringify(check.detail);
      console.log(`  ${mark} ${check.name}${detail}`);
    }
    console.log("");
  }

  const failed = state.checks.filter((c) => c.status === "FAIL").length;
  const ok = state.checks.filter((c) => c.status === "OK").length;
  const skipped = state.checks.filter((c) => c.status === "SKIPPED").length;
  console.log(`${ok} ok, ${failed} failed, ${skipped} skipped (group access)`);
  console.log(`\nstate file: ${STATE_PATH}`);

  if (failed) process.exitCode = 1;
}

const stage = process.argv[2] ?? "report";
const stages: Record<string, () => Promise<void>> = {
  auto,
  prompts,
  collect,
  listen,
  report,
};
const run = stages[stage];
if (!run) {
  console.error(`unknown stage "${stage}"; use auto|prompts|collect|report`);
  process.exit(1);
}
run().catch((error) => {
  console.error("probe crashed:", redact(String(error)));
  process.exit(1);
});
