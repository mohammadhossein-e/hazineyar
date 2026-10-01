/**
 * Session constants, deliberately free of imports.
 *
 * `proxy.ts` needs the cookie name and nothing else, and a proxy runs apart
 * from the render code (on a CDN it is not even the same process), so it must
 * not pull in anything that reads the environment. Keeping the two names here
 * means auth and the proxy can never drift apart.
 */
export const SESSION_COOKIE = "hazineyar_admin";

/**
 * Label mixed into the session token so it is not a bare hash of the admin
 * password, and so rotating this label invalidates every existing cookie.
 */
export const SESSION_TOKEN_LABEL = "hazineyar.dashboard.v1";
