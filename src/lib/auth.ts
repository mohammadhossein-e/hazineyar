import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";
import { SESSION_COOKIE, SESSION_TOKEN_LABEL } from "./session";

/**
 * STOPGAP, NOT AUTH. There are no user accounts in this MVP: anyone who knows
 * `ADMIN_PASSWORD` is the admin, and the cookie only proves the password was
 * typed once. Replace this with real users, a password hash in the database and
 * server-side sessions before this is exposed to the internet.
 */

/** A day per sign-in; the browser drops the cookie after that. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time comparison over fixed-length digests. Hashing first means
 * `timingSafeEqual` never sees two buffers of different lengths (it throws on
 * that) and no length information leaks through the comparison.
 */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function verifyAdminPassword(input: string): boolean {
  return safeEqual(input, config.adminPassword);
}

/**
 * The cookie value is *derived* from `ADMIN_PASSWORD` instead of being stored
 * anywhere, so changing the password invalidates every issued session at once
 * and there is no session table to clean up.
 */
function sessionToken(): string {
  return createHmac("sha256", config.adminPassword)
    .update(SESSION_TOKEN_LABEL)
    .digest("hex");
}

/** The authoritative check: a real comparison, not just cookie presence. */
export async function isSessionValid(): Promise<boolean> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return typeof value === "string" && safeEqual(value, sessionToken());
}

export async function startSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Plain HTTP on localhost is fine; anything real should be HTTPS.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** For pages that must not render without a session. */
export async function requireSession(): Promise<void> {
  if (!(await isSessionValid())) redirect("/dashboard/login");
}
