/**
 * Central token redaction.
 *
 * A bot token can appear in a surprising number of places: the URL of a failed
 * `fetch`, a grammY error message that embeds the request target
 * (`https://api.telegram.org/bot<token>/...`), a nested `cause`, or a raw probe
 * response body. Every one of those paths funnels through here before it reaches
 * the console, so a leaked token is structurally impossible rather than relying
 * on each call site remembering.
 *
 * The replacement is deliberately a fixed marker rather than a truncation: the
 * reader still sees *that* a token was there and that it was scrubbed.
 */
export const TOKEN_MASK = "«token»";

/** Replaces every occurrence of every configured secret in `text`. */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    // split/join instead of a RegExp: bot tokens contain `:` and `-`, and
    // escaping them correctly is a needless source of bugs.
    if (secret) out = out.split(secret).join(TOKEN_MASK);
  }
  return out;
}

/** Depth cap so a pathological nested structure can never blow the stack. */
const MAX_DEPTH = 6;

/**
 * Redacts strings anywhere inside a value: arrays, plain objects, and `Error`s
 * (message, stack and `cause`). Anything else — numbers, booleans, functions,
 * class instances without an `Error` prototype — is returned untouched, since
 * it cannot carry the token in text form.
 *
 * An `Error` is rebuilt as a real `Error` so `console.error` still prints a
 * stack rather than `{}`.
 */
export function redactValue(
  value: unknown,
  secrets: readonly string[],
): unknown {
  return redactInner(value, secrets, new WeakSet<object>(), 0);
}

function redactInner(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (typeof value !== "object" || value === null) return value;

  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    const redacted = new Error(redactText(value.message, secrets));
    redacted.name = value.name;
    if (value.stack) redacted.stack = redactText(value.stack, secrets);
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) {
      (redacted as { cause?: unknown }).cause = redactInner(
        cause,
        secrets,
        seen,
        depth + 1,
      );
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, secrets, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = redactInner(nested, secrets, seen, depth + 1);
  }
  return out;
}
