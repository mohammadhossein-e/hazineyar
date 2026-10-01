import type { ReactNode } from "react";
import Link from "next/link";
import { isSessionValid } from "@/lib/auth";
import { logout } from "./actions";
import styles from "./dashboard.module.css";

/**
 * Shell for everything under /dashboard.
 *
 * The layout deliberately does **not** redirect: /dashboard/login lives inside
 * it, so a guard here would loop. `proxy.ts` turns away cookie-less visitors and
 * `requireSession()` in the page does the authoritative check.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const signedIn = await isSessionValid();

  return (
    <div className={styles.shell}>
      {signedIn && (
        <header className={styles.header}>
          <div>
            <div className={styles.title}>داشبورد مدیر</div>
            <div className={styles.subtitle}>هزینه‌یار — گزارش هزینه‌های پروژه‌ها</div>
          </div>
          <div className={styles.headerActions}>
            <Link href="/dashboard" className={styles.button}>
              گزارش هزینه‌ها
            </Link>
            <Link href="/dashboard/admin" className={styles.button}>
              مدیریت کاربران و پروژه‌ها
            </Link>
            <form action={logout}>
              <button type="submit" className={styles.button}>
                خروج
              </button>
            </form>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
