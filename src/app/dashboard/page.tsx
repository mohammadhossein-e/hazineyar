import Link from "next/link";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/core/expenses/categories";
import { listExpensesQuerySchema } from "@/core/expenses/schemas";
import { presentExpenses, presentSummary } from "@/core/expenses/presenter";
import { getExpenseSummary, listExpenses } from "@/core/expenses/service";
import { listProjects, listAllProjects } from "@/core/projects/service";
import { listUsers, listAllUsers } from "@/core/users/service";
import { requireSession } from "@/lib/auth";
import { FilterBar } from "./filter-bar";
import styles from "./dashboard.module.css";

const PAGE_SIZE = 20;

/** Latin digits with thousands separators, matching the bot's confirmations. */
const formatToman = (value: number) => value.toLocaleString("en-US");

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

type DateParam =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "value"; iso: string };

/**
 * `expenseDate` is a calendar date held as a UTC instant (see lib/jalali), and
 * an `<input type="date">` hands us a bare `YYYY-MM-DD`. Turning the upper bound
 * into the end of that UTC day keeps a same-day entry from falling outside the
 * range, which is what a plain midnight would do. `Date.UTC` rolls overflows
 * (2026-02-31) into the next month, so the round trip is compared back to catch
 * a hand-edited URL rather than silently searching the wrong month.
 */
function dateParam(value: string, end: boolean): DateParam {
  if (!value) return { state: "absent" };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { state: "invalid" };
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(
    Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0),
  );
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { state: "invalid" };
  }
  return { state: "value", iso: date.toISOString() };
}

type Filters = {
  project: string;
  category?: string;
  user?: string;
  from?: string;
  to?: string;
  page?: number;
  all?: string;
};

/** Keeps the project filter even when empty: "" is the "all projects" view. */
function dashboardHref(filters: Filters): string {
  const params = new URLSearchParams();
  params.set("project", filters.project);
  for (const key of ["category", "user", "from", "to", "all"] as const) {
    if (filters[key]) params.set(key, filters[key]!);
  }
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return `/dashboard?${params.toString()}`;
}

/**
 * The export endpoint speaks the API's parameter names (projectId/dateFrom/
 * dateTo/userId) while the dashboard URL uses project/from/to/user, so the
 * current filters are translated here. Invalid or absent dates are dropped; an
 * empty project means "all projects" and drops projectId entirely.
 */
function exportHref(current: Filters, datesOk: boolean): string {
  const params = new URLSearchParams();
  if (current.project) params.set("projectId", current.project);
  if (current.category) params.set("category", current.category);
  if (current.user) params.set("userId", current.user);
  if (datesOk) {
    if (current.from) params.set("dateFrom", current.from);
    if (current.to) params.set("dateTo", current.to);
  }
  return `/api/expenses/export?${params.toString()}`;
}

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  await requireSession();

  const query = await searchParams;
  // Deactivated projects and users are hidden by default so the filters only
  // offer live ones, but their expenses still have to be reportable, so ?all=1
  // brings them back into the dropdowns (marked as inactive).
  const showInactive = single(query.all) === "1";
  const [allProjects, allUsers] = showInactive
    ? await Promise.all([listAllProjects(), listAllUsers()])
    : [null, null];
  const projects = allProjects ?? (await listProjects());
  const users = allUsers ?? (await listUsers());

  // Absent `project` means "no choice yet" and falls back to the first active
  // project, while an explicit "" is the all-projects view. An unknown id also
  // falls back, rather than rendering an empty dashboard.
  const requested = query.project === undefined ? undefined : single(query.project);
  const known = requested ? projects.find((p) => p.id === requested) : undefined;
  const allProjectsView = requested === "";
  const fallback = projects.find((p) => p.isActive) ?? projects[0];
  const selected = allProjectsView ? undefined : (known ?? fallback);

  const category = single(query.category);
  const user = single(query.user);
  const from = dateParam(single(query.from), false);
  const to = dateParam(single(query.to), true);
  const page = Math.max(1, Number(single(query.page)) || 1);

  const candidate = {
    ...(selected ? { projectId: selected.id } : {}),
    ...(user ? { userId: user } : {}),
    ...(category ? { category } : {}),
    ...(from.state === "value" ? { dateFrom: from.iso } : {}),
    ...(to.state === "value" ? { dateTo: to.iso } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  // Only a hand-edited URL can produce this, but a broken filter must not take
  // the page down: fall back to an unfiltered first page and say so.
  const filters = listExpensesQuerySchema.safeParse(candidate);
  const datesBroken = from.state === "invalid" || to.state === "invalid";
  const serviceQuery = filters.success
    ? {
        // listExpenses filters on from/to; the query schema validates them as
        // dateFrom/dateTo, so they are renamed here rather than dropped.
        projectId: filters.data.projectId,
        userId: filters.data.userId,
        category: filters.data.category,
        from: filters.data.dateFrom,
        to: filters.data.dateTo,
        page: filters.data.page,
        pageSize: filters.data.pageSize,
      }
    : { page: 1, pageSize: PAGE_SIZE };

  let result = await listExpenses(serviceQuery);
  // A ?page=99 beyond the end reads as "no results"; show the last real page.
  if (result.total > 0 && result.page > result.totalPages) {
    result = await listExpenses({ ...serviceQuery, page: result.totalPages });
  }

  const expenses = presentExpenses(result.items);
  // No selected project ("همه پروژه‌ها") aggregates across every project.
  const summary = presentSummary(await getExpenseSummary(selected?.id));

  const current: Filters = {
    project: selected?.id ?? "",
    category,
    user,
    from: from.state === "absent" ? "" : single(query.from),
    to: to.state === "absent" ? "" : single(query.to),
    all: showInactive ? "1" : "",
  };

  const statCards = [
    { label: "امروز", value: summary.today, period: summary.periods.today },
    { label: "این هفته", value: summary.thisWeek, period: summary.periods.thisWeek },
    { label: "این ماه", value: summary.thisMonth, period: summary.periods.thisMonth },
  ];

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Keyed by the query: navigating with new filters remounts the form so the
          uncontrolled defaultValues never show stale selections. */}
      <FilterBar
        key={[current.project, current.category ?? "", current.user ?? "", current.from ?? "", current.to ?? "", current.all].join("\u0000")}
        projects={projects.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
        users={users.map((u) => ({ id: u.id, name: u.name, isActive: u.isActive }))}
        categories={ALL_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
        initial={{ ...current, category: current.category ?? "", user: current.user ?? "", from: current.from ?? "", to: current.to ?? "", all: current.all ?? "" }}
        exportHref={exportHref(current, from.state !== "invalid" && to.state !== "invalid")}
      />

      {(!filters.success || datesBroken) && (
        <p className={styles.error}>
          فیلترهای واردشده معتبر نبود؛ بدون فیلتر نمایش داده شده است.
        </p>
      )}

      <section className={styles.stats}>
        {statCards.map((card) => (
          <div key={card.label} className={styles.stat}>
            <span className={styles.statLabel}>{card.label}</span>
            <span className={styles.statAmount}>
              {formatToman(card.value.total)} تومان
            </span>
            <span className={styles.statMeta}>
              {card.value.count} مورد — از {card.period.fromJalali}
            </span>
          </div>
        ))}
      </section>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>شماره فاکتور</th>
              <th>تاریخ</th>
              <th>پروژه</th>
              <th>دسته‌بندی</th>
              <th>مبلغ (تومان)</th>
              <th>ثبت‌کننده</th>
              <th>توضیحات</th>
              <th>فاکتور</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  هزینه‌ای با این فیلترها یافت نشد.
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{expense.invoiceNumber}</td>
                  <td title={expense.expenseDate}>{expense.expenseDateJalali}</td>
                  <td>{expense.projectName ?? "—"}</td>
                  <td>{expense.categoryLabel}</td>
                  <td className={styles.amount}>{formatToman(expense.amount)}</td>
                  <td>{expense.userName ?? "—"}</td>
                  <td className={styles.wrap}>{expense.description ?? "—"}</td>
                  <td>
                    {expense.invoiceUrl ? (
                      <a
                        href={expense.invoiceUrl}
                        className={styles.invoiceLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        دریافت
                      </a>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav className={styles.pager} aria-label="صفحه‌بندی">
        <span className={styles.muted}>
          مجموع {result.total} مورد — صفحه {result.page} از {result.totalPages || 1}
        </span>
        <div className={styles.pagerLinks}>
          {result.page > 1 ? (
            <Link className={styles.button} href={dashboardHref({ ...current, page: result.page - 1 })}>
              قبلی
            </Link>
          ) : (
            <span className={`${styles.button} ${styles.muted}`}>قبلی</span>
          )}
          {result.page < result.totalPages ? (
            <Link className={styles.button} href={dashboardHref({ ...current, page: result.page + 1 })}>
              بعدی
            </Link>
          ) : (
            <span className={`${styles.button} ${styles.muted}`}>بعدی</span>
          )}
        </div>
      </nav>
    </main>
  );
}
