"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type FormEvent } from "react";
import styles from "./dashboard.module.css";

type MenuOption = { id: string; name: string; isActive?: boolean };
type CategoryOption = { value: string; label: string };

export type FilterBarValues = {
  project: string;
  category: string;
  user: string;
  from: string;
  to: string;
  /** "1" keeps deactivated projects/users in the dropdowns, for history. */
  all: string;
};

type FilterBarProps = {
  projects: MenuOption[];
  users: MenuOption[];
  categories: CategoryOption[];
  initial: FilterBarValues;
  /** Prebuilt /api/expenses/export href from the page's current filters. */
  exportHref: string;
};

/** Inactive options are only present when the toggle is on, so mark them. */
function label(option: MenuOption): string {
  return option.isActive === false ? `${option.name} (غیرفعال)` : option.name;
}

/**
 * The dashboard is fully server-rendered and reads its filters from the query
 * string, so every change is expressed as a new URL. Selecting a project, a
 * category, a user or a date immediately pushes the form's live values through
 * Next's router; the native GET submit remains as the no-JS fallback (the page
 * in /dashboard/page.tsx is keyed by the query so the fields remount fresh).
 */
export function FilterBar({ projects, users, categories, initial, exportHref }: FilterBarProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    const params = new URLSearchParams();
    const data = new FormData(form);
    for (const key of ["project", "category", "user", "from", "to", "all"] as const) {
      const value = data.get(key);
      if (typeof value !== "string") continue;
      // project is always kept ("" is the all-projects view); empty siblings
      // are dropped so the URL reads like dashboardHref builds it.
      if (key !== "project" && value === "") continue;
      params.set(key, value);
    }
    router.push(`/dashboard?${params.toString()}`);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply();
  };

  return (
    <form ref={formRef} method="get" action="/dashboard" onSubmit={onSubmit} className={styles.filters}>
      <label className={styles.field}>
        <span className={styles.label}>پروژه</span>
        <select name="project" className={styles.select} defaultValue={initial.project} onChange={apply}>
          <option value="">همه پروژه‌ها</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {label(project)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>دسته‌بندی</span>
        <select name="category" className={styles.select} defaultValue={initial.category} onChange={apply}>
          <option value="">همه</option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>ثبت‌کننده</span>
        <select name="user" className={styles.select} defaultValue={initial.user} onChange={apply}>
          <option value="">همه</option>
          {users.map((record) => (
            <option key={record.id} value={record.id}>
              {label(record)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>از تاریخ</span>
        <input type="date" name="from" className={styles.input} defaultValue={initial.from} onChange={apply} />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>تا تاریخ</span>
        <input type="date" name="to" className={styles.input} defaultValue={initial.to} onChange={apply} />
      </label>

      <label className={styles.checkItem}>
        <input
          type="checkbox"
          name="all"
          value="1"
          defaultChecked={initial.all === "1"}
          onChange={apply}
        />
        <span>نمایش پروژه‌ها و کاربران غیرفعال</span>
      </label>

      <div className={styles.filterActions}>
        <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
          اعمال فیلتر
        </button>
        <Link href="/dashboard" className={styles.button}>
          پاک کردن
        </Link>
        {/* A native link so the browser hands the attachment to the download
            manager; the export endpoint requires the admin session cookie,
            which the request carries automatically. */}
        <a href={exportHref} className={styles.button}>
          دانلود Excel
        </a>
      </div>
    </form>
  );
}