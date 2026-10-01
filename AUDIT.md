# Hazineyar — Final Audit Report

Date: 2026-09-30
Scope: security, data correctness, reliability of the MVP before real staff use.

## 1. Fixed during the audit

| Area | Change |
|---|---|
| **Weak default password** | Prod now refuses to start unless `ADMIN_PASSWORD` is set and ≥8 characters (`src/lib/config.ts`). `admin123` only exists in dev/seed. |
| **Write endpoints were open** | `POST /api/expenses`, `POST /api/expenses/:id/invoice`, `DELETE /api/expenses/:id` now require the dashboard session cookie and return `401` otherwise. GET endpoints stay public by design. |
| **Webhook fail-secure** | The Telegram webhook route 404s unless `TELEGRAM_MODE=webhook` and 403s any update without a matching `X-Telegram-Bot-Api-Secret-Token` (empty secret = refuse). |
| **Invoice number races** | Unique index on `(projectId, invoiceNumber)` (migration `20260930120000_add_invoice_number_unique`, applied) plus a P2002 retry loop in `createExpense` that recomputes the number before giving up with a clear Persian error. |
| **Orphan upload files** | The invoice route deletes the newly uploaded file if attaching fails, and deletes the replaced file on re-upload (`deleteInvoiceFile` in `src/lib/uploads.ts`). |
| **Path traversal / URI errors** | Invoice download now returns `400` on URI-decoding errors; traversal attempts stay rejected. |
| **Bot failure behavior** | Conversation entry and command handlers catch DB errors and reply `genericError` (Persian) instead of crashing or leaking; unknown users get `notRegistered`. |
| **Brute-force throttle** | 400ms delay on failed dashboard login (`src/app/dashboard/actions.ts`). Documented as a stopgap. |
| **Dead / misleading code** | Removed unused `jalaliToGregorian` helper, which produced local-timezone Dates and caused off-by-one risk. |
| **Ops tooling** | Added `scripts/manage.ts` provisioning CLI (`npm run manage`): create/list/deactivate users and projects, link users to projects. README documents production deployment, provisioning, and admin-password rotation. `.env` locked to `0600`. |

## 2. Deferred — bigger changes, intentionally not built

- **Shared-secret auth, not real sessions** — the dashboard cookie is an HMAC of `ADMIN_PASSWORD` with no expiry or IP binding. Rotation is instant, but this is not a real session store. Fine for a small staff; upgrade to proper auth if the user base grows. (The staff management screen added afterwards sits behind this same gate, so anyone holding that password can add and deactivate users and projects.)
- **No audit trail of deletes** — soft-deleted rows remain in the DB but there is no "who deleted this" column. Cheap to add later.
- **No backups/retention automation** — README documents `pg_dump` + the `UPLOAD_DIR` volume as the two sources of truth; no script ships.
- **Plain-HTTP in dev** — production must be behind TLS for both the dashboard and the webhook.
- **No self-service** — user/project provisioning is CLI-only by design.
- **O(count) invoice numbering** — per-project counting on insert; switch to a Postgres sequence/table if insert volume ever grows.

## 3. Verification

| Check | Result |
|---|---|
| `npm run test:expenses` | 110 passed / 0 failed (incl. multi-billion amounts, 401 gates, Jalali year/leap boundaries, soft-delete summary/export exclusion, deterministic invoice numbers) |
| `npm run test:bot` | 102 passed / 0 failed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |
| Live curls | health `200`; webhook POST in polling mode `404`; write without cookie `401`; dashboard → login redirect; login `200` |

## 4. Verdict

**Ready for real staff use** for a single trusted team, with these operational
requirements: a strong `ADMIN_PASSWORD`, HTTPS in front, and nightly backups of
both the database and the upload directory. The two items that justify a real
redesign (proper sessions, webhook secret rotation) are documented here as
known limitations rather than silent gaps.