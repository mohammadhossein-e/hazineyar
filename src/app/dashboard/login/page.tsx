import { redirect } from "next/navigation";
import { isSessionValid } from "@/lib/auth";
import { login } from "../actions";
import styles from "../dashboard.module.css";

/**
 * The whole gate: one password, no accounts. `ADMIN_PASSWORD` from the
 * environment is the only credential in this MVP.
 */
export default async function LoginPage({
  searchParams,
}: PageProps<"/dashboard/login">) {
  if (await isSessionValid()) redirect("/dashboard");

  const { error } = await searchParams;
  const failed = error === "1";

  return (
    <main className={styles.loginShell}>
      <form action={login} className={styles.loginCard}>
        <div className={styles.loginTitle}>ورود به داشبورد مدیر</div>

        {failed && <div className={styles.error}>رمز عبور نادرست است.</div>}

        <label className={styles.field}>
          <span className={styles.label}>رمز عبور</span>
          <input
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>

        <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
          ورود
        </button>

        <p className={styles.hint}>
          این نسخه رمز مشترک دارد و کاربر و نقش ندارد؛ برای محیط واقعی باید ورود
          واقعی اضافه شود.
        </p>
      </form>
    </main>
  );
}
