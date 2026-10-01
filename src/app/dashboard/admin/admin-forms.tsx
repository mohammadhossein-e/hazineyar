"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "../dashboard.module.css";

type JsonFormProps = {
  /** API route to POST the form to, e.g. /api/admin/projects. */
  action: string;
  children?: ReactNode;
  submitLabel: string;
  /** Values with no input of their own, e.g. the isActive a toggle posts. */
  fixed?: Record<string, unknown>;
  /**
   * Checkbox names that must always be sent as an array, even when nothing is
   * ticked — that is how "revoke every project" is expressed.
   */
  listFields?: string[];
  className?: string;
  /**
   * Filled (default) or outline. Row-level actions pass false so a table of
   * them does not turn into a wall of solid buttons; a form's submit stays
   * filled, which is the one action the eye should land on.
   */
  primary?: boolean;
};

/**
 * The admin screen's one form primitive. It posts JSON to an /api/admin route
 * and, on success, re-renders the server component and clears the form; on
 * failure it shows the API's Persian error in place instead of navigating away,
 * so a rejected duplicate id or a bad name never looks like it worked.
 *
 * Everything the owner does is a small write, so there is no optimistic state
 * here: the button is disabled while the request is in flight, and the list it
 * just changed comes back from the server.
 */
export function JsonForm({
  action,
  children,
  submitLabel,
  fixed,
  listFields = [],
  className,
  primary = true,
}: JsonFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const payload: Record<string, unknown> = { ...fixed };
    for (const key of listFields) payload[key] = data.getAll(key).map(String);
    data.forEach((value, key) => {
      if (!(key in payload)) payload[key] = value;
    });

    setPending(true);
    setError(null);
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          body?.error?.message ?? "ذخیره نشد؛ لطفاً دوباره تلاش کنید.",
        );
        return;
      }

      form.reset();
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد؛ لطفاً دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className={className}>
      {children}
      <div className={styles.actions}>
        <button
          type="submit"
          className={[styles.button, primary && styles.buttonPrimary]
            .filter(Boolean)
            .join(" ")}
          disabled={pending}
        >
          {pending ? "در حال ذخیره…" : submitLabel}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
