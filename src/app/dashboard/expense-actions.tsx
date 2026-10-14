"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/core/expenses/categories";
import styles from "./dashboard.module.css";

type Option = { id: string; name: string };

export type ActionableExpense = {
  id: string;
  projectId: string;
  userId: string;
  category: string;
  amount: number;
  description: string | null;
  updatedAt: string;
};

type HistoryEntry = {
  id: string;
  actionLabel: string;
  actorLabel: string;
  reason: string | null;
  createdAtJalali: string;
};

/**
 * Per-row corrections for the dashboard. Kept tight and non-optimistic: every
 * action posts to the admin API, then re-renders the server component so the
 * table always reflects the committed state. Delete and edit carry the row's
 * `updatedAt` as an optimistic-concurrency token; a 409 tells the admin the row
 * changed underneath them instead of quietly overwriting it.
 */
export function ExpenseActions({
  expense,
  projects,
  users,
  deleted,
}: {
  expense: ActionableExpense;
  projects: Option[];
  users: Option[];
  deleted: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const run = async (
    action: () => Promise<Response>,
    onOk?: () => void,
  ) => {
    setPending(true);
    setError(null);
    try {
      const response = await action();
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? "ذخیره نشد؛ لطفاً دوباره تلاش کنید.");
        return;
      }
      onOk?.();
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد؛ لطفاً دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  };

  const json = (method: string, url: string, body: unknown) =>
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const submitEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      projectId: String(data.get("projectId") ?? ""),
      userId: String(data.get("userId") ?? ""),
      category: String(data.get("category") ?? ""),
      amount: Number(data.get("amount")),
      description: String(data.get("description") ?? "").trim() || null,
      expectedUpdatedAt: expense.updatedAt,
    };
    void run(() =>
      json("PATCH", `/api/admin/expenses/${expense.id}`, payload),
    );
  };

  const submitDelete = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    void run(() =>
      json("DELETE", `/api/admin/expenses/${expense.id}`, {
        ...(reason ? { reason } : {}),
        expectedUpdatedAt: expense.updatedAt,
      }),
    );
  };

  const restore = () =>
    void run(() => json("POST", `/api/admin/expenses/${expense.id}/restore`, {}));

  const loadHistory = async () => {
    if (history) {
      setShowHistory((value) => !value);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/expenses/${expense.id}/history`,
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message ?? "تاریخچه بارگذاری نشد.");
        return;
      }
      setHistory((body?.history as HistoryEntry[]) ?? []);
      setShowHistory(true);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.actions}>
      {deleted ? (
        <button
          type="button"
          className={styles.button}
          onClick={restore}
          disabled={pending}
        >
          بازگردانی
        </button>
      ) : (
        <>
          <details className={styles.details}>
            <summary className={styles.button}>ویرایش</summary>
            <form onSubmit={submitEdit} className={styles.accessForm}>
              <label className={styles.field}>
                <span className={styles.label}>پروژه</span>
                <select
                  name="projectId"
                  className={styles.select}
                  defaultValue={expense.projectId}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>ثبت‌کننده</span>
                <select
                  name="userId"
                  className={styles.select}
                  defaultValue={expense.userId}
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>دسته‌بندی</span>
                <select
                  name="category"
                  className={styles.select}
                  defaultValue={expense.category}
                >
                  {ALL_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>مبلغ (تومان)</span>
                <input
                  type="number"
                  name="amount"
                  min={1}
                  step={1}
                  required
                  defaultValue={expense.amount}
                  className={styles.input}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>توضیحات</span>
                <input
                  type="text"
                  name="description"
                  maxLength={500}
                  defaultValue={expense.description ?? ""}
                  className={styles.input}
                />
              </label>
              <button
                type="submit"
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={pending}
              >
                {pending ? "در حال ذخیره…" : "ذخیره ویرایش"}
              </button>
            </form>
          </details>

          <details className={styles.details}>
            <summary className={styles.button}>حذف</summary>
            <form onSubmit={submitDelete} className={styles.accessForm}>
              <label className={styles.field}>
                <span className={styles.label}>دلیل (اختیاری)</span>
                <input
                  type="text"
                  name="reason"
                  maxLength={500}
                  className={styles.input}
                  placeholder="مثلاً ثبت تکراری"
                />
              </label>
              <button
                type="submit"
                className={styles.button}
                disabled={pending}
              >
                حذف هزینه
              </button>
            </form>
          </details>
        </>
      )}

      <button
        type="button"
        className={styles.button}
        onClick={loadHistory}
        disabled={pending}
      >
        تاریخچه
      </button>

      {showHistory && history && (
        <div className={styles.historyPanel}>
          {history.length === 0 ? (
            <span className={styles.muted}>تغییری ثبت نشده است.</span>
          ) : (
            <ul className={styles.historyList}>
              {history.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.actionLabel}</strong> — {entry.actorLabel} —{" "}
                  {entry.createdAtJalali}
                  {entry.reason ? ` — ${entry.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
