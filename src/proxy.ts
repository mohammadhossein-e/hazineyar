import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

const LOGIN_PATH = "/dashboard/login";

/**
 * Fast gate for every /dashboard/* page: no cookie, straight to the login form.
 *
 * This only checks that the cookie is *present*. The real comparison against
 * ADMIN_PASSWORD lives in `lib/auth.ts` and runs in the page and layout,
 * because a proxy can be deployed apart from the app and must not be the only
 * thing standing between the data and a forged cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === LOGIN_PATH) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = LOGIN_PATH;
  target.search = "";
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
