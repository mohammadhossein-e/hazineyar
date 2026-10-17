import { redactText, redactValue } from "@/lib/redact";

export type LogLevel = "log" | "warn" | "error";

export type ChannelLogger = {
  log(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
};

/**
 * The adapter logs straight to the console — there is no logging dependency in
 * this project — but every line goes through this factory so the `[channel]`
 * prefix and the timestamp stay identical across adapters instead of each call
 * site inventing its own format.
 *
 * The token is redacted from both the message and the detail object before
 * anything is printed, so no path can leak it.
 */
export function createChannelLogger(
  prefix: string,
  secrets: readonly string[],
): ChannelLogger {
  const write = (level: LogLevel, message: string, detail?: unknown): void => {
    const line = `[${prefix}] ${new Date().toISOString()} ${redactText(
      message,
      secrets,
    )}`;
    if (detail === undefined) console[level](line);
    else console[level](line, redactValue(detail, secrets));
  };

  return {
    log: (message, detail) => write("log", message, detail),
    warn: (message, detail) => write("warn", message, detail),
    error: (message, detail) => write("error", message, detail),
  };
}
