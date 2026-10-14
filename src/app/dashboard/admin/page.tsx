import Link from "next/link";
import {
  presentAccessRequests,
  type PresentedAccessRequest,
} from "@/core/access/presenter";
import {
  listPendingAccessRequests,
  listRejectedAccessRequests,
} from "@/core/access/service";
import { presentProjects, type PresentedProject } from "@/core/projects/presenter";
import { listAllProjects } from "@/core/projects/service";
import { getAnnouncementSettings } from "@/core/settings/service";
import { getCancellationSettings } from "@/core/settings/service";
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

  const [projects, users, pendingRequests, rejectedRequests, settings, cancellation] =
    await Promise.all([
      listAllProjects(),
      listAllUsers(),
      listPendingAccessRequests(),
      listRejectedAccessRequests(),
      getAnnouncementSettings(),
      getCancellationSettings(),
    ]);
  const viewProjects = presentProjects(projects);
  const viewUsers = presentUsers(users);
  const activeProjects = viewProjects.filter((p) => p.isActive);
  const pending = presentAccessRequests(pendingRequests);
  const rejected = presentAccessRequests(rejectedRequests);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.panelTitle}>درخواست‌های دسترسی</h2>
        </div>

        {pending.length === 0 ? (
          <p className={styles.emptyState} data-testid="pending-empty">
            از کارمند بخواهید ربات را در پیام خصوصی Start کند. درخواستش اینجا
            نمایش داده می‌شود.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>نام کاربری تلگرام</th>
                  <th>تاریخ درخواست</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((request) => (
                  <tr key={request.id}>
                    <td data-label="نام">{request.displayName}</td>
                    <td data-label="نام کاربری تلگرام">
                      {request.username ? (
                        `@${request.username}`
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td data-label="تاریخ درخواست">{request.createdAtJalali}</td>
                    <td data-label="عملیات">
                      <div className={styles.actions}>
                        <details className={styles.details}>
                          <summary className={styles.button}>تایید</summary>
                          <ApproveForm
                            request={request}
                            activeProjects={activeProjects}
                          />
                        </details>
                        <JsonForm
                          action={`/api/admin/access-requests/${request.id}/reject`}
                          submitLabel="رد"
                          primary={false}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rejected.length > 0 && (
          <>
            <p className={styles.hint}>
              درخواست‌های ردشده؛ در صورت نیاز می‌توانید تصمیم را با «تایید
              مجدد» برگردانید.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>نام کاربری تلگرام</th>
                    <th>تاریخ درخواست</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((request) => (
                    <tr key={request.id}>
                      <td data-label="نام">{request.displayName}</td>
                      <td data-label="نام کاربری تلگرام">
                        {request.username ? (
                          `@${request.username}`
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td data-label="تاریخ درخواست">{request.createdAtJalali}</td>
                      <td data-label="عملیات">
                        <details className={styles.details}>
                          <summary className={styles.button}>تایید مجدد</summary>
                          <ApproveForm
                            request={request}
                            activeProjects={activeProjects}
                          />
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className={styles.hint}>
          کاربران ناشناس تلگرام که در چت خصوصی ربات دستور /start را می‌زنند
          اینجا فهرست می‌شوند. با «تایید» حساب ساخته می‌شود و به کاربر در
          تلگرام اطلاع داده می‌شود؛ «رد» تا زمانی که خودتان تصمیم را عوض
          نکنید باقی می‌ماند.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.panelTitle}>تنظیمات اعلام در گروه</h2>
        </div>
        <JsonForm
          action="/api/admin/settings"
          submitLabel="ذخیره تنظیمات"
          boolFields={["includeInvoice", "announceDirectExpenses"]}
          className={styles.panel}
        >
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>حالت اعلام در گروه</span>
              <select
                name="announceMode"
                className={styles.select}
                defaultValue={settings.announceMode}
              >
                <option value="FULL">
                  کامل (نام، پروژه، دسته، مبلغ، توضیحات، شماره فاکتور)
                </option>
                <option value="MINIMAL">
                  خلاصه (فقط ثبت شد + نام + پروژه)
                </option>
                <option value="OFF">خاموش (اعلام نشود)</option>
              </select>
            </label>
          </div>
          <div className={styles.checklist}>
            <label className={styles.checkItem}>
              <input
                type="checkbox"
                name="includeInvoice"
                defaultChecked={settings.includeInvoice}
              />
              <span>ارسال فایل فاکتور همراه اعلام در گروه</span>
            </label>
            <label className={styles.checkItem}>
              <input
                type="checkbox"
                name="announceDirectExpenses"
                defaultChecked={settings.announceDirectExpenses}
              />
              <span>اعلام هزینه‌های ثبت‌شده مستقیم در گروه</span>
            </label>
          </div>
        </JsonForm>
        <p className={styles.hint}>
          این تنظیمات هنگام ثبت هر هزینه از دیتابیس خوانده می‌شود، پس تغییر
          آن‌ها بدون راه‌اندازی دوباره ربات اعمال می‌شود. اعلام فقط به
          گروه‌هایی فرستاده می‌شود که با دستور /linkgroup متصل شده‌اند.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.panelTitle}>لغو هزینه توسط ثبت‌کننده</h2>
        </div>
        <JsonForm
          action="/api/admin/cancellation-settings"
          submitLabel="ذخیره تنظیمات"
          className={styles.panel}
        >
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.label}>
                مهلت لغو (دقیقه) — صفر یعنی غیرفعال
              </span>
              <input
                type="number"
                name="windowMinutes"
                min={0}
                max={1440}
                step={1}
                required
                defaultValue={cancellation.windowMinutes}
                className={styles.input}
              />
            </label>
          </div>
        </JsonForm>
        <p className={styles.hint}>
          پس از ثبت هر هزینه، دکمه «لغو این هزینه» به مدت این مهلت به خود
          ثبت‌کننده نشان داده می‌شود. با عدد صفر، این دکمه نمایش داده نمی‌شود و
          لغو فقط از داشبورد ممکن است.
        </p>
      </section>

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
                    <td data-label="نام پروژه">{project.name}</td>
                    <td data-label="وضعیت">
                      <StatusBadge active={project.isActive} />
                    </td>
                    <td data-label="تعداد هزینه‌ها" className={styles.amount}>
                      {formatToman(project.expenseCount ?? 0)}
                    </td>
                    <td data-label="عملیات">
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

        <details className={styles.disclosure} data-testid="manual-user">
          <summary className={styles.disclosureSummary}>
            افزودن دستی کاربر (پیشرفته)
          </summary>
          <div className={styles.disclosureBody}>
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
                این فرم فقط برای کسانی است که هنوز با ربات تماس نگرفته‌اند و در
                فهرست «درخواست‌های دسترسی» بالا دیده نمی‌شوند. شناسه عددی تلگرام
                را می‌توانید از یک درخواست دسترسی کپی کنید، یا کاربر آن را از
                ربات @userinfobot بگیرد. اگر شخص قبلاً در چت خصوصی /start زده
                باشد، به‌جای این فرم از «تایید» همان درخواست استفاده کنید.
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
          </div>
        </details>

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
                    <td data-label="نام">{user.name}</td>
                    <td data-label="نقش">{user.roleLabel}</td>
                    <td data-label="شناسه تلگرام">
                      <span className={styles.muted}>{user.externalId}</span>
                    </td>
                    <td data-label="وضعیت">
                      <StatusBadge active={user.isActive} />
                    </td>
                    <td data-label="پروژه‌های مرتبط" className={styles.wrap}>
                      {user.projects.length === 0
                        ? "—"
                        : user.projects
                            .map((p) => (p.isActive ? p.name : `${p.name} (غیرفعال)`))
                            .join("، ")}
                    </td>
                    <td data-label="عملیات">
                      <div className={styles.actions}>
                        <JsonForm
                          action={`/api/admin/users/${user.id}/status`}
                          fixed={{ isActive: !user.isActive }}
                          submitLabel={user.isActive ? "غیرفعال کردن" : "فعال کردن"}
                          primary={false}
                        />
                        <details className={styles.details}>
                          <summary className={styles.button}>ویرایش نام</summary>
                          <JsonForm
                            action={`/api/admin/users/${user.id}/name`}
                            submitLabel="ذخیره نام"
                            className={styles.accessForm}
                          >
                            <label className={styles.field}>
                              <span className={styles.label}>نام کاربر</span>
                              <input
                                type="text"
                                name="name"
                                required
                                minLength={2}
                                maxLength={80}
                                defaultValue={user.name}
                                className={styles.input}
                              />
                            </label>
                            <span className={styles.reference}>
                              نام جدید در گزارش‌ها، فایل اکسل و هزینه‌های
                              قبلی این کاربر نمایش داده می‌شود.
                            </span>
                          </JsonForm>
                        </details>
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

/**
 * The approve form shared by the pending and rejected lists. The name is
 * prefilled with what Telegram reported, the admin can correct it, and the
 * same server-side validation as the manual form runs on submit.
 */
function ApproveForm({
  request,
  activeProjects,
}: {
  request: PresentedAccessRequest;
  activeProjects: PresentedProject[];
}) {
  return (
    <JsonForm
      action={`/api/admin/access-requests/${request.id}/approve`}
      submitLabel="تایید و ساخت کاربر"
      listFields={["projectIds"]}
      className={styles.accessForm}
    >
      <label className={styles.field}>
        <span className={styles.label}>نام کاربر</span>
        <input
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={request.displayName}
          className={styles.input}
        />
        <span className={styles.reference}>
          روی تلگرام: {request.displayName}
          {request.username ? ` — @${request.username}` : ""}
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>نقش</span>
        <select name="role" className={styles.select} defaultValue="EMPLOYEE">
          <option value="EMPLOYEE">کارمند</option>
          <option value="ADMIN">ادمین</option>
        </select>
      </label>

      <span className={styles.label}>
        پروژه‌هایی که مجاز به ثبت هزینه در آن‌هاست
      </span>
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
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`${styles.badge} ${active ? styles.badgeActive : styles.badgeInactive}`}>
      {active ? "فعال" : "غیرفعال"}
    </span>
  );
}
