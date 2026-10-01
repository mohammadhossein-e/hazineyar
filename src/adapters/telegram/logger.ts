/**
 * The adapter logs straight to the console — there is no logging dependency in
 * this project — but every line goes through here so the `[telegram]` prefix
 * and the timestamp stay identical across the adapter instead of each call
 * site inventing its own format.
 */
function write(
  level: "log" | "warn" | "error",
  message: string,
  detail?: unknown,
): void {
  const line = `[telegram] ${new Date().toISOString()} ${message}`;
  if (detail === undefined) console[level](line);
  else console[level](line, detail);
}

export function telegramLog(message: string, detail?: unknown): void {
  write("log", message, detail);
}

export function telegramWarn(message: string, detail?: unknown): void {
  write("warn", message, detail);
}

export function telegramError(message: string, detail?: unknown): void {
  write("error", message, detail);
}
