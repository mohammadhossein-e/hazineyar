import Link from "next/link";
import { presentProjects } from "@/core/projects/presenter";
import { listAllProjects } from "@/core/projects/service";
import { presentUsers } from "@/core/users/presenter";
import { listAllUsers } from "@/core/users/service";
import { requireSession } from "@/lib/auth";
import styles from "../dashboard.module.css";
import { JsonForm } from "./admin-forms";

/** Latin digits with thousands separators, like the expense table. */
const formatToman = (value: number) => value.toLocaleString("en-US");

/**
 * Staff and project management for the owner, inside the same session as the
 * rest of /dashboard: no second login, no per-user passwords.
 *
 * Everything on this page is a thin form over /api/admin, and both entities are
 * soft: deactivating keeps every expense, the invoice numbers and the reports,
 * and only closes the door for new entries (the bot stops offering the project,
 * or refuses the account). Nothing here deletes anything.
 */
export default async function AdminPage() {
  await requireSession();

  const [projects, users] = await Promise.all([listAllProjects(), listAllUsers()]);
  const viewProjects = presentProjects(projects);
  const viewUsers = presentUsers(users);
  const activeProjects = viewProjects.filter((p) => p.isActive);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.panelTitle}>پروژه‌ها</h2>
          <Link href="/dashboard" className={styles.button}>
            بازگشت به گزارش هزینه‌ها
          </Link>
        </div>

        <JsonForm
          action="/api/admin/projects"
          submitLabel="افزودن پروژه جدید"
          className={styles.panel}
        >
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>نام پروژه</span>
              <input
                type="text"
                name="name"
                required
                maxLength={80}
                className={styles.input}
                placeholder="مثلاً پروژه غرب تهران"
              />
            </label>
          </div>
        </JsonForm>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>نام پروژه</th>
                <th>وضعیت</th>
                <th>تعداد هزینه‌ها</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {viewProjects.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    هنوز پروژه‌ای ساخته نشده است.
                  </td>
                </tr>
              ) : (
                viewProjects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.name}</td>
                    <td>
                      <StatusBadge active={project.isActive} />
                    </td>
                    <td className={styles.amount}>
                      {formatToman(project.expenseCount ?? 0)}
                    </td>
                    <td>
                      <JsonForm
                        action={`/api/admin/projects/${project.id}/status`}
                        fixed={{ isActive: !project.isActive }}
                        submitLabel={project.isActive ? "غیرفعال کردن" : "فعال کردن"}
                        className={styles.actions}
                        primary={false}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.hint}>
          غیرفعال کردن پروژه هیچ هزینه‌ای را حذف نمی‌کند؛ فقط پروژه دیگر در
          انتخاب ربات و فیلترهای پیش‌فرض داشبورد پیشنهاد نمی‌شود. برای دیدن
          گزارش آن، در صفحه گزارش‌ها گزینه «نمایش پروژه‌های غیرفعال» را بزنید.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.panelTitle}>کاربران</h2>
        </div>

        <JsonForm
          action="/api/admin/users"
          submitLabel="افزودن کارمند جدید"
          listFields={["projectIds"]}
          className={styles.panel}
        >
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>نام و نام خانوادگی</span>
              <input
                type="text"
                name="name"
                required
                maxLength={80}
                className={styles.input}
                placeholder="مثلاً سعید محمدی"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>شناسه عددی تلگرام</span>
              <input
                type="text"
                name="externalId"
                required
                inputMode="numeric"
                pattern="[0-9]{5,20}"
                className={styles.input}
                placeholder="مثلاً 123456789"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>نقش</span>
              <select name="role" className={styles.select} defaultValue="EMPLOYEE">
                <option value="EMPLOYEE">کارمند</option>
                <option value="ADMIN">ادمین</option>
              </select>
            </label>
          </div>

          <span className={styles.label}>
            پروژه‌هایی که مجاز به ثبت هزینه در آن‌هاست
          </span>
          <p className={styles.hint}>
            کارمند باید ابتدا یک‌بار به ربات پیام بدهد (مثلاً دستور /start) و
            سپس شناسه عددی خود را از ربات UserInfoBot (@userinfobot) بگیرد و همین‌جا
            وارد کند. ربات کاربر را با همین شناسه پیدا می‌کند.
          </p>
          <div className={styles.checklist}>
            {activeProjects.length === 0 ? (
              <span className={styles.muted}>هنوز پروژه فعالی وجود ندارد.</span>
            ) : (
              activeProjects.map((project) => (
                <label key={project.id} className={styles.checkItem}>
                  <input type="checkbox" name="projectIds" value={project.id} />
                  <span>{project.name}</span>
                </label>
              ))
            )}
          </div>
        </JsonForm>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>نام</th>
                <th>نقش</th>
                <th>شناسه تلگرام</th>
                <th>وضعیت</th>
                <th>پروژه‌های مرتبط</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {viewUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    هنوز کاربری ثبت نشده است.
                  </td>
                </tr>
              ) : (
                viewUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.roleLabel}</td>
                    <td>
                      <span className={styles.muted}>{user.externalId}</span>
                    </td>
                    <td>
                      <StatusBadge active={user.isActive} />
                    </td>
                    <td className={styles.wrap}>
                      {user.projects.length === 0
                        ? "—"
                        : user.projects
                            .map((p) => (p.isActive ? p.name : `${p.name} (غیرفعال)`))
                            .join("، ")}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <JsonForm
                          action={`/api/admin/users/${user.id}/status`}
                          fixed={{ isActive: !user.isActive }}
                          submitLabel={user.isActive ? "غیرفعال کردن" : "فعال کردن"}
                          primary={false}
                        />
                        <details className={styles.details}>
                          <summary className={styles.button}>
                            ویرایش دسترسی پروژه‌ها
                          </summary>
                          <JsonForm
                            action={`/api/admin/users/${user.id}/projects`}
                            submitLabel="ذخیره دسترسی‌ها"
                            listFields={["projectIds"]}
                            className={styles.accessForm}
                          >
                            <div className={styles.checklist}>
                              {viewProjects.map((project) => (
                                <label
                                  key={project.id}
                                  className={styles.checkItem}
                                >
                                  <input
                                    type="checkbox"
                                    name="projectIds"
                                    value={project.id}
                                    defaultChecked={user.projects.some(
                                      (p) => p.id === project.id,
                                    )}
                                  />
                                  <span>
                                    {project.name}
                                    {project.isActive ? "" : " (غیرفعال)"}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </JsonForm>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.hint}>
          غیرفعال کردن کاربر هزینه‌های ثبت‌شده‌اش را حذف نمی‌کند و نامش در
          گزارش‌ها باقی می‌ماند؛ فقط ربات از آن پس به او اجازه ثبت هزینه نمی‌دهد.
          برای حذف دسترسی به یک پروژه بدون غیرفعال کردن کاربر، از «ویرایش
          دسترسی پروژه‌ها» استفاده کنید.
        </p>
      </section>
    </main>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`${styles.badge} ${active ? styles.badgeActive : styles.badgeInactive}`}>
      {active ? "فعال" : "غیرفعال"}
    </span>
  );
}
