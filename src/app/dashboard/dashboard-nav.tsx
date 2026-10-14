"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { logout } from "./actions";
import styles from "./dashboard.module.css";

const NAV_LINKS = [
  { href: "/dashboard", label: "داشبورد" },
  { href: "/dashboard/admin", label: "مدیریت کاربران و پروژه‌ها" },
] as const;

/**
 * The dashboard chrome. On wide screens the two links and «خروج» sit inline in
 * the header; on narrow screens they collapse behind a hamburger that opens a
 * drawer sliding in from the right (the inline-start edge in RTL).
 *
 * Accessibility: the trigger carries an `aria-label` and `aria-expanded`, the
 * drawer is a labelled modal dialog, focus moves into it on open and returns to
 * the trigger on close, Tab is trapped inside, and Escape or a backdrop tap
 * closes it. Any link tap also closes it so navigation does not leave it open.
 *
 * `pendingRequests` badges the admin link (header and drawer) only when there
 * are pending access requests, so the count is a nudge, never a permanent "0".
 */
export function DashboardNav({ pendingRequests }: { pendingRequests: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const adminBadge = (link: (typeof NAV_LINKS)[number]) =>
    link.href === "/dashboard/admin" && pendingRequests > 0 ? (
      <span
        className={styles.navBadge}
        data-testid="pending-badge"
        aria-label={`${pendingRequests} درخواست در انتظار`}
      >
        {pendingRequests}
      </span>
    ) : null;

  useEffect(() => {
    if (!open) return;

    const drawer = drawerRef.current;
    const focusables = drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trigger = triggerRef.current;

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, close]);

  const linkClass = (href: string) =>
    pathname === href
      ? `${styles.navLink} ${styles.navLinkActive}`
      : styles.navLink;

  return (
    <>
      <header className={styles.appBar}>
        <div className={styles.appBarStart}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.menuButton}
            aria-label="باز کردن منو"
            aria-expanded={open}
            aria-controls="dashboard-drawer"
            onClick={() => setOpen(true)}
          >
            <svg
              className={styles.menuIcon}
              viewBox="0 0 24 24"
              width="24"
              height="24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <div className={styles.brand}>
            <span className={styles.title}>داشبورد مدیر</span>
            <span className={styles.subtitle}>هزینه‌یار — گزارش هزینه‌ها</span>
          </div>
        </div>

        <nav className={styles.desktopNav} aria-label="ناوبری اصلی">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              {link.label}
              {adminBadge(link)}
            </Link>
          ))}
          <form action={logout}>
            <button type="submit" className={styles.navLink}>
              خروج
            </button>
          </form>
        </nav>
      </header>

      {open && (
        <>
          <div
            className={styles.drawerBackdrop}
            onClick={close}
            aria-hidden="true"
          />
          <div
            id="dashboard-drawer"
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="منوی داشبورد"
          >
            <div className={styles.drawerHeader}>
              <span className={styles.drawerTitle}>منو</span>
              <button
                type="button"
                className={styles.menuButton}
                aria-label="بستن منو"
                onClick={close}
              >
                <svg
                  className={styles.menuIcon}
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
            </div>

            <nav className={styles.drawerLinks} aria-label="ناوبری">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={linkClass(link.href)}
                  onClick={close}
                >
                  {link.label}
                  {adminBadge(link)}
                </Link>
              ))}
              <form action={logout}>
                <button type="submit" className={styles.navLink}>
                  خروج
                </button>
              </form>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
