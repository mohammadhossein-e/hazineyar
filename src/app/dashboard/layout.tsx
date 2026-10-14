import type { ReactNode } from "react";
import { countPendingAccessRequests } from "@/core/access/service";
import { isSessionValid } from "@/lib/auth";
import { DashboardNav } from "./dashboard-nav";
import styles from "./dashboard.module.css";

/**
 * Shell for everything under /dashboard.
 *
 * The layout deliberately does **not** redirect: /dashboard/login lives inside
 * it, so a guard here would loop. `proxy.ts` turns away cookie-less visitors and
 * `requireSession()` in the page does the authoritative check.
 *
 * The chrome (header + mobile drawer) is a client component so the hamburger
 * can open, trap focus and close on Escape; the session check stays here on the
 * server and the login page therefore renders without any chrome. The pending
 * access-request count is read here only when signed in, to badge the admin
 * link in both the header and the drawer.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const signedIn = await isSessionValid();
  const pendingRequests = signedIn ? await countPendingAccessRequests() : 0;

  return (
    <div className={styles.shell}>
      {signedIn && <DashboardNav pendingRequests={pendingRequests} />}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
