# هزینه‌یار (Hazineyar)

Construction expense tracking MVP. Persian is the user-facing language; the code,
comments and identifiers are in English.

This repository is the whole Hazineyar MVP: the project foundation and the
**expense backend** (API + business logic), the **Telegram bot** (guided entry
with optional invoice/photo upload), the manager **dashboard** (filters,
pagination and all-projects summary), the **Excel export**, and the **staff
management screen** where the owner adds projects and workers and decides who
may record where.

## Tech stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL 16 + Prisma 7
- Docker Compose for the local database
- Zod for validation
- `jalaali-js` for Jalali (Shamsi) date conversion
- grammY for the Telegram bot

## Architecture

The business logic must stay independent of any messaging channel, so that
Telegram, Bale or a plain web form can each be added as an adapter later.

```
src/
  core/            pure business logic — no Telegram/HTTP imports
    expenses/      expense recording, listing, soft delete, totals
      service.ts   business rules (permissions, invoice numbers, summary)
      schemas.ts   Zod validation for bodies and query strings
      categories.ts Persian labels + category parsing
      presenter.ts JSON-safe views (BigInt -> number)
    projects/      project lookups and creation
    users/         user lookup by (channel, externalId), project access
    errors.ts      channel-agnostic domain errors
  adapters/        channel adapters (empty for now; see adapters/README.md)
  app/             Next.js routes, pages and API handlers (thin layer)
    api/expenses/  expense endpoints
    api/invoices/  uploaded invoice files
    api/health/    DB health check
  lib/             Prisma client, env config, jalali helpers, http + upload utils
scripts/
  test-expenses.ts end-to-end check against a running dev server
```

Rules:

- `core/` may import from `lib/`, never from `adapters/` or `app/`.
- `app/` and `adapters/` are the only layers allowed to know about HTTP or
  Telegram; they translate their transport into calls on `core/`.
- A user is identified across channels by the pair `(channel, externalId)`,
  e.g. `("telegram", "123456789")`.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env

# 3. Start PostgreSQL
docker compose up -d

# 4. Create the database schema (creates a migration in prisma/migrations)
npx prisma migrate dev

# 5. Load the sample data
npx prisma db seed

# 6. Start the dev server
npm run dev
```

The app is served on <http://localhost:3000> (Next.js picks the next free port
if 3000 is already taken).

### Environment variables

| Variable              | Required | Default     | Purpose                                   |
| --------------------- | -------- | ----------- | ----------------------------------------- |
| `DATABASE_URL`        | yes      | –           | PostgreSQL connection string              |
| `TELEGRAM_BOT_TOKEN`  | no       | `""`        | Bot token; empty disables the bot         |
| `UPLOAD_DIR`          | no       | `./uploads` | Where invoice files are stored            |
| `ADMIN_PASSWORD`      | no       | `admin123`  | Dashboard session password (dev default)  |
| `TELEGRAM_MODE`       | no       | `polling`   | `polling` (dev) or `webhook` (prod)       |
| `TELEGRAM_WEBHOOK_SECRET` | no   | `""`        | Secret that must be sent on every update  |
| `TELEGRAM_WEBHOOK_URL`| no       | `""`        | Public HTTPS URL of `/api/telegram/webhook` |
| `HOSTNAME`/`PORT`     | no       | `0.0.0.0`/`3000` | `next start` bind address               |

`src/lib/config.ts` validates these at startup with Zod and throws with a clear
message if `DATABASE_URL` is missing. **In production `ADMIN_PASSWORD` must be
set explicitly and be at least 8 characters — the server refuses to start
otherwise.** The webhook route deliberately 404s unless `TELEGRAM_MODE` is
`webhook` and 403s any update without a matching `X-Telegram-Bot-Api-Secret-Token`.

## Data model

- **User** — `name`, `channel`, `externalId`, `role` (`ADMIN` \| `EMPLOYEE`),
  `isActive`, `createdAt`. Unique on `(channel, externalId)`.
- **Project** — `name`, `isActive`, `createdAt`.
- **UserProject** — links a user to the projects they may record expenses for
  (unique per user/project pair).
- **Expense** — `projectId`, `userId`, `category`, `amount` (BigInt, whole
  Toman), `description?`, `invoiceFilePath?`, `invoiceNumber` (auto-generated,
  e.g. `invoice_001`), `expenseDate`, `createdAt`, `deletedAt` for soft delete.
  Indexed on `projectId`, `userId`, `category`, `expenseDate` and `deletedAt`.

Expense categories are stored as the `ExpenseCategory` enum with Persian labels
kept next to it in `src/core/expenses/categories.ts`:

| Enum          | فارسی          |
| ------------- | -------------- |
| `MATERIALS`   | مصالح          |
| `WORKER_FOOD` | غذای کارگران   |
| `TRANSPORT`   | حمل‌ونقل        |
| `WAGES`       | دستمزد          |
| `TOOLS`       | ابزار           |
| `OTHER`       | سایر           |

`parseCategory()` accepts either the English key or the Persian label, so a
Telegram user can type `مصالح` or `MATERIALS`.

## Seed data

Three projects (سعادت‌آباد, پاسداران, ونک) and three users:

| User    | channel / externalId | Role      | Projects                |
| ------- | -------------------- | --------- | ----------------------- |
| Admin   | `telegram/admin001`  | `ADMIN`   | all three               |
| رضا     | `telegram/reza001`   | `EMPLOYEE`| سعادت‌آباد, پاسداران      |
| علی     | `telegram/ali001`    | `EMPLOYEE`| ونک                     |

The seed is idempotent, so `npx prisma db seed` can be re-run safely.

Project IDs are fixed (`proj-saadatabad`, `proj-pasdaran`, `proj-vank`), but
user IDs are generated cuids. Look them up once per environment:

```bash
export REZA=$(docker compose exec -T db psql -U hazineyar -d hazineyar -t -A \
  -c "SELECT id FROM \"User\" WHERE externalId = 'reza001'")
export ADMIN=$(docker compose exec -T db psql -U hazineyar -d hazineyar -t -A \
  -c "SELECT id FROM \"User\" WHERE externalId = 'admin001'")
```

## Expense API

Reads (`GET`) are public — the Telegram bot and the dashboard share the same
data — but every **write** (`POST /api/expenses`, `POST .../invoice`,
`DELETE ...`) and the Excel export require the dashboard's session: a request
must carry the `hazineyar_admin` cookie holding an HMAC-SHA256 token over the
admin password. Without it a write returns `401`. The acting user is still
passed explicitly (`userId` on create, `requestingUserId` on delete) and
checked against the `UserProject` links.

Errors always use this shape:

```json
{ "error": { "message": "متن فارسی خطا", "code": "FORBIDDEN", "details": [] } }
```

`code` is one of `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_MULTIPART`,
`NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `INTERNAL_ERROR`. Validation failures
add a `details` array of `{ field, message }` in Persian.

### `POST /api/expenses` — create

```bash
curl -X POST http://localhost:3000/api/expenses \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "proj-saadatabad",
    "userId": "'"$REZA"'",
    "category": "MATERIALS",
    "amount": 1250000,
    "description": "سیمان و میلگرد",
    "expenseDate": "2026-09-29"
  }'
```

`201` returns the stored expense. `amount` is whole Toman; decimals, zero and
negatives are rejected with `400`. Employees may only record on projects they
are linked to via `UserProject` (otherwise `403`); admins may record anywhere.

### `GET /api/expenses` — list and filter

```bash
curl "http://localhost:3000/api/expenses?projectId=proj-saadatabad&category=مصالح&page=1&pageSize=20"
curl "http://localhost:3000/api/expenses?userId=$REZA&dateFrom=2026-09-01&dateTo=2026-09-29"
```

| Param        | Notes                                                  |
| ------------ | ------------------------------------------------------ |
| `projectId`  | exact match                                            |
| `userId`     | exact match                                            |
| `category`   | enum key **or** Persian label (`مصالح`, `MATERIALS`)   |
| `dateFrom`   | inclusive, `YYYY-MM-DD`                                |
| `dateTo`     | inclusive, `YYYY-MM-DD`                                |
| `page`       | default `1`                                            |
| `pageSize`   | default `20`, max `100`                                |

```json
{
  "items": [ { "id": "...", "invoiceNumber": "invoice_001", "amount": 1250000, "categoryLabel": "مصالح", "expenseDateJalali": "1405/07/07", "...": "..." } ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

Soft-deleted expenses are never returned.

### `GET /api/expenses/export` — Excel (`xlsx`) download (ADMIN only)

Takes the same filters as the list — `projectId`, `userId`, `category` (key or
Persian label), `dateFrom`, `dateTo` — but returns a generated workbook with
every matching row (no pagination, capped at 10 000 by a clear error), with a
Jalali date, project, recorder, category label, amount and invoice number.
A bare `dateTo` counts the whole day, matching the list endpoint.

The dashboard's "دانلود Excel" button builds this URL from its current filters.
This one is admin-gated, unlike the public list: requests without a valid
dashboard session cookie get `401`.

```bash
curl -H "Cookie: hazineyar_admin=<session-token>" -o expenses.xlsx \
  "http://localhost:3000/api/expenses/export?projectId=proj-saadatabad&dateFrom=2026-09-01&dateTo=2026-09-30"
```

### `GET /api/expenses/summary?projectId=...` — totals

`projectId` is optional: omit it to get the same totals aggregated across
every project (the response's `projectId` is then `null`).

```bash
curl "http://localhost:3000/api/expenses/summary?projectId=proj-saadatabad"
```

```json
{
  "projectId": "proj-saadatabad",
  "today":     { "total": 3000000, "count": 3 },
  "thisWeek":  { "total": 3000000, "count": 3 },
  "thisMonth": { "total": 3000000, "count": 3 },
  "periods": { "today": { "from": "...", "to": "...", "fromJalali": "1405/07/07" } }
}
```

`thisWeek` is the Iranian week (Saturday–Friday) and `thisMonth` the current
Jalali month. Both are clamped to the end of today, so the ranges mean "spent
so far" and `today` is always a subset of the two.

### `GET /api/expenses/:id` — one expense

```bash
curl http://localhost:3000/api/expenses/<expenseId>
```

`404` if unknown or soft-deleted.

### `DELETE /api/expenses/:id` — soft delete (ADMIN only)

Also needs the session cookie; `requestingUserId` may be a query param or a
JSON body:

```bash
curl -X DELETE -H "Cookie: hazineyar_admin=<session-token>" \
  "http://localhost:3000/api/expenses/<expenseId>?requestingUserId=$ADMIN"
curl -X DELETE -H "Cookie: hazineyar_admin=<session-token>" \
  -H 'Content-Type: application/json' -d '{"requestingUserId":"'"$ADMIN"'"}'
  "http://localhost:3000/api/expenses/<expenseId>"
```

Employees get `403`. The row is kept with `deletedAt` set, so it disappears
from every listing but remains auditable.

### `POST /api/expenses/:id/invoice` — attach an invoice file

```bash
curl -X POST -H "Cookie: hazineyar_admin=<session-token>" \
  http://localhost:3000/api/expenses/<expenseId>/invoice -F "file=@/path/to/factor.jpg"
```

`multipart/form-data`, single field named `file`, jpeg/png/webp/pdf, max 5 MB.
The file is stored under `UPLOAD_DIR` as `<invoiceNumber>_<uuid>.<ext>`, and only
the file name is written to `invoiceFilePath`.

### `GET /api/invoices/:filename` — download an invoice

```bash
curl -OJ http://localhost:3000/api/invoices/invoice_001_9f2c....jpg
```

The name is validated against path traversal before anything is read from disk.

### Design notes

- **Invoice numbers are sequential per project** (`invoice_001`, `invoice_002`,
  ... restarting for each project), and soft-deleted rows are still counted so
  a number is never reissued. Count and insert share a transaction, a unique
  index on `(projectId, invoiceNumber)` backstops it, and a race retries the
  insert a few times before giving up.
- **`expenseDate` is a calendar date.** A date-only string is stored as UTC
  midnight, and all range filters compare UTC-midnight boundaries, so
  day/week/month filtering is stable regardless of the server timezone. The
  `periods` block in the summary response makes the exact boundaries visible.
- **`amount` is a BigInt in the database but a JSON number on the wire**, since
  `JSON.stringify` cannot serialize BigInt. All rendering goes through
  `presenter.ts`.
- **`POST` requires the English enum key.** A Telegram user typing `مصالح` is
  translated by the adapter using `parseCategory()`; the `GET` filter accepts
  both forms because query strings come straight from clients.

## Production deployment

```bash
# 1. Apply any pending migrations (idempotent)
npx prisma migrate deploy

# 2. Build and start on all interfaces
npm run build
HOSTNAME=0.0.0.0 PORT=3000 npm run start
```

Environment checklist for a production server:

- `DATABASE_URL` pointing at the real Postgres, **not** the Docker one.
- `ADMIN_PASSWORD` set to a strong (>8 chars) secret. The server refuses to
  start without it. There is no tunnel back to the default `admin123`.
- `UPLOAD_DIR` on the mounted volume that backs invoices (Docker volume, NAS,
  object store). The server fails to start if it cannot create it.
- The bot in `polling` mode needs outbound HTTPS to `api.telegram.org`. Behind
  a firewall, prefer `TELEGRAM_MODE=webhook` behind a reverse proxy with TLS:
  set `TELEGRAM_WEBHOOK_URL` to the public HTTPS URL and
  `TELEGRAM_WEBHOOK_SECRET` to a random secret; `npm run start` registers the
  webhook at boot and the route only trusts that secret.
- Run at least two instances or add a process manager for zero-downtime
  restarts (`next start` is a single process).

Database backups: a nightly `pg_dump` plus the invoice upload directory are the
two hard sources of truth to protect.

## Staff management (from the dashboard)

The normal way to add a project or a worker is the dashboard itself, at
**/dashboard/admin** (the "مدیریت کاربران و پروژه‌ها" button in the header). It is
behind the same session cookie as the rest of `/dashboard` — one shared
`ADMIN_PASSWORD`, no per-user accounts.

- **پروژه‌ها** — every project with its live expense count, a name field to add
  one, and an activate/deactivate button per row.
- **کاربران** — name, numeric Telegram id, role (کارمند/ادمین) and the projects
  the person may record on, plus a "ویرایش دسترسی پروژه‌ها" editor per row to
  change that list later without recreating the user, and an activate/deactivate
  button.
- Telegram is the only channel, so it is fixed server-side rather than asked
  for.

To add a brand-new worker end to end: create the project, create the employee
with their `@userinfobot` numeric id and tick the projects, and the person can
message the bot right away. Nothing else has to be restarted.

**Deactivating is not deleting.** A deactivated project stops appearing in the
bot's project picker and in the dashboard's default filters; a deactivated user
is refused by the bot with "شما دسترسی ثبت هزینه ندارید". In both cases the
expenses, the invoice numbers and the reports stay exactly as they were, and
reactivating restores the same rows and links. The dashboard's report page has a
"نمایش پروژه‌ها و کاربران غیرفعال" checkbox so a closed project's history is
still reportable.

The UI posts JSON to the same routes, which are session-gated like the Excel
export and can be scripted directly:

| Route | Purpose |
| ----- | ------- |
| `GET /api/admin/projects` | every project, active or not, with expense counts |
| `POST /api/admin/projects` | `{ name }` |
| `POST /api/admin/projects/:id/status` | `{ isActive }` |
| `GET /api/admin/users` | every user, active or not, with project access |
| `POST /api/admin/users` | `{ name, externalId, role, projectIds }` |
| `POST /api/admin/users/:id/status` | `{ isActive }` |
| `POST /api/admin/users/:id/projects` | `{ projectIds }` — replaces the list |

A duplicate active project name, a duplicate Telegram id, a non-numeric id, an
unknown project and a blank field are all rejected server-side with a Persian
message, which the UI shows in place.

## Managing users and projects from the CLI

`scripts/manage.ts` does the same operations for a terminal or a deployment
script, calling the same core services, so its validation and messages match the
UI exactly. It is a fallback, not the primary workflow:

```bash
# Users
npm run manage -- list-users
npm run manage -- create-user --name "سعید" --external 100445 --role employee --projects proj-saadatabad,proj-pasdaran
npm run manage -- deactivate-user --external 100445
npm run manage -- reactivate-user --external 100445

# Projects
npm run manage -- list-projects
npm run manage -- create-project --id proj-gharb --name "غرب تهران"   # id optional
npm run manage -- deactivate-project --id proj-gharb
npm run manage -- reactivate-project --id proj-gharb

# Linking
npm run manage -- link-user --external 100445 --project proj-gharb
```

`--external` is the user's numeric Telegram id (the value `update.from.id`
emits); the bot resolves users by `(channel, externalId)`. `--channel` defaults
to `telegram`. Neither tool deletes anything: deactivation is the only removal,
exactly as in the UI.

## Rotating the admin password

The dashboard session is an HMAC over `ADMIN_PASSWORD`, so rotating is just
changing the env var and restarting — every old session token stops working
immediately:

```bash
ADMIN_PASSWORD="<new-strong-secret>" npm run start
```

The seeded admin **user** record is unrelated to this password and needs no
change.

## Verifying it works

1. **Health check** — the endpoint runs `SELECT 1` against the database:

   ```bash
   curl http://localhost:3000/api/health
   ```

   Healthy response is `200`:

   ```json
   { "status": "ok", "database": "connected" }
   ```

   If PostgreSQL is not running it returns `503` with
   `{"status":"error","database":"disconnected"}`.

2. **End-to-end API check** — with the dev server running, this drives the whole
   flow (create, validation, permissions, list, filter, pagination, summary,
   upload, download, soft delete) and prints a pass/fail line per assertion:

   ```bash
   npm run test:expenses
   ```

   It creates and soft-deletes real rows, so it is safe to re-run.

3. **Staff management check** — the admin routes plus the flow they exist for: a
   project and an employee are created through the API, the employee logs a real
   expense through the bot, and both deactivations are checked against the bot.
   It cleans up its own fixtures:

   ```bash
   npm run test:admin
   ```

4. **Bot check** — the Telegram adapter end to end against a stubbed API (no
   token, no network), including deactivated users and projects:

   ```bash
   npm run test:bot
   ```

5. **Data landed** — inspect the tables:

   ```bash
   npx prisma studio
   ```

   You should see 3 users, 3 projects and 6 `UserProject` rows.

6. **Type checks and build**:

   ```bash
   npx tsc --noEmit
   npm run lint
   npm run build
   ```

## Notes on Prisma 7

Prisma 7 differs from older versions in two ways that are already handled here:

- The connection string lives in `prisma.config.ts` (with `migrations.seed`),
  not in the `datasource` block of `schema.prisma`.
- The runtime client needs an explicit driver adapter, so `src/lib/db.ts`
  constructs `new PrismaPg({ connectionString })` and passes it to
  `new PrismaClient({ adapter })`.
