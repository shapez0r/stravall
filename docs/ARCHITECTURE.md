# eurofish architecture

## Goals

1. **Self-sufficient** — one static binary contains the HTTP server, API, web
   UI, schema migrations and background jobs. No runtime, interpreter or
   separate frontend server is needed.
2. **Scale down** — on a laptop it needs nothing but a writable directory
   (SQLite + in-process cache).
3. **Scale up** — the server is stateless; point every replica at the same
   MariaDB and Valkey and put any load balancer in front.
4. **Portable** — the same artifact runs as a `FROM scratch` container, a
   systemd service, a Kubernetes pod or PID 1 inside a microVM.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | Go 1.23 | Fast, single static binary, tiny memory footprint, trivial cross-compilation |
| HTTP | Fiber v2 (fasthttp) | Very fast, Express-like routing, batteries-included middleware |
| Database (single node) | SQLite via `modernc.org/sqlite` | Pure Go → `CGO_ENABLED=0` static binary; WAL mode for concurrent reads |
| Database (multi node) | MariaDB / MySQL | Open source, shared state for many replicas |
| Cache | in-process or Valkey/Redis | Valkey shares session and ledger caches across replicas |
| UI | Vanilla HTML/CSS/JS, embedded | No build toolchain, strict CSP, works offline from the binary |

## Layout

```
cmd/eurofish/          entry point: serve | migrate | healthcheck | version
internal/config/       environment configuration
internal/db/           connection handling + embedded, versioned migrations per dialect
internal/store/        data access (portable SQL for SQLite and MariaDB)
internal/finance/      pure recurrence + running-balance engine (unit tested)
internal/cache/        Cache interface: memory and Valkey/Redis backends
internal/auth/         password hashing, session tokens, identity-provider interface
internal/server/       Fiber app, middleware, HTTP handlers
web/static/            single-page UI, embedded with go:embed
deploy/                nginx, systemd, microVM rootfs, Kubernetes
```

## Data model

All money is stored as signed integer **cents** (`BIGINT`): positive is
income, negative is an expense. Dates are ISO `YYYY-MM-DD` strings, timestamps
are unix seconds and IDs are application-generated UUIDs. This keeps the SQL
identical on SQLite and MariaDB.

- `users` — e-mail, display name, bcrypt password hash (nullable for future
  external-only accounts)
- `auth_identities` — `(provider, subject) → user`; reserved for Google/Apple
- `sessions` — SHA-256 hash of the opaque session token, expiry
- `calendars` — name, currency, balance date, starting balance, `version`
- `calendar_members` — `(calendar, user, role)` with role `owner|editor|viewer`
- `calendar_invites` — `(calendar, e-mail, role)` shares for people without an
  account yet; turned into `calendar_members` rows when they sign up
- `events` — title, amount, category, note, start date, recurrence, repeat interval (X for "every X weeks"), optional end date
- `event_skips` — single occurrences removed from a repeating event
- `balance_overrides` — (calendar, date) → manually set end-of-day balance

## Balance engine

`internal/finance` expands every series into concrete dates for the
requested window and computes, for each day, the income, expenses and the
end-of-day balance:

```
balance(day) = starting balance + Σ occurrences on [balance date, day]
```

Monthly/quarterly/yearly series that start on the 29th–31st fall on the last
day of shorter months. `monthly_day` repeats on the exact day number and skips
months that do not have it; `monthly_nth` repeats on the same weekday occurrence
as the start date (e.g. first Monday; a start on day 29–31 means the last one).
A balance override sets a day's end-of-day balance after its transactions; the
following days continue from it. Overrides may also be dated before the
balance date: the balance then runs from the earliest override and is set to
the starting balance again on the balance date (the latest known balance wins;
the jump is reported as `start_adjustment`). The ledger endpoint caches its result under a key that
includes the calendar's `version`, which is incremented in the same
transaction as every write — caches are never stale and need no explicit
invalidation, on one node or many.

## Scaling model

- **Stateless replicas** — sessions live in the database; lookups are cached
  for 60 s (memory or Valkey). Any replica can serve any request.
- **Migrations** run on start-up. On MariaDB a `GET_LOCK` makes concurrent
  replica start-ups safe; on SQLite immediate transactions serialise them.
- **Health** — `/healthz` (process up) and `/readyz` (database and cache
  reachable) for load balancers and orchestrators.
- **Graceful shutdown** on SIGTERM with a 15 s drain.
- **Rate limiting** of sign-in/sign-up is per replica (in-memory).

## Security

- bcrypt (cost 12) password hashes; constant-time-ish login for unknown users
- Opaque 256-bit session tokens in `HttpOnly`, `SameSite=Lax` cookies; only
  their SHA-256 hash is stored
- State-changing requests must be JSON (or carry `X-Requested-With`), which
  blocks cross-site form posts
- Strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`
- Optional sign-up restriction to given networks (`EUROFISH_SIGNUP_CIDRS`)
- Container runs as non-root from an empty (`scratch`) image

## Adding Google / Apple sign-in

Implement `auth.Provider` (OIDC authorization-code flow) for each provider,
add `/api/auth/{provider}/start` and `/api/auth/{provider}/callback` routes,
and on callback look up `auth_identities` by `(provider, subject)`: sign in the
linked user, or create a user (no password) plus identity row. Existing
e-mail/password accounts keep working unchanged.

## HTTP API

All endpoints are JSON under `/api`. Errors are `{"error": "message"}`.

| Method | Path | Notes |
|---|---|---|
| GET | `/config` | `{signup_enabled, version}` |
| POST | `/auth/signup` | `{email, password, display_name}` → user + session cookie |
| POST | `/auth/login` | `{email, password}` → user + session cookie |
| POST | `/auth/logout` | |
| GET | `/me` | current user |
| GET / POST | `/calendars` | list / create `{name, currency, start_date, start_balance}` |
| GET / PATCH / DELETE | `/calendars/:id` | delete is owner-only |
| GET / POST | `/calendars/:id/members` | add `{email, role: editor\|viewer}` (owner); unknown e-mails become a pending invite (202) |
| PATCH | `/calendars/:id/members/:userId` | change `{role: editor\|viewer}` (owner) |
| DELETE | `/calendars/:id/members/:userId` | owner removes, member leaves |
| GET | `/calendars/:id/invites` | pending shares for e-mails without an account |
| DELETE | `/calendars/:id/invites/:email` | cancel a pending share (owner) |
| GET / POST | `/calendars/:id/events` | `{title, amount, category, note, start_date, recurrence, interval, until_date}`; `interval` is X (1–520) for recurrence `weeks` (repeat every X weeks) |
| PUT / DELETE | `/calendars/:id/events/:eventId` | edit / delete the whole series |
| POST | `/calendars/:id/events/:eventId/skip` | `{date}` removes one occurrence |
| POST | `/calendars/:id/events/:eventId/occurrence` | `{date, title, amount, category, note, start_date}` changes only that occurrence: it is removed from the series and a one-off transaction is created instead |
| GET | `/calendars/:id/balances` | manually set balances `[{date, balance}]` |
| PUT / DELETE | `/calendars/:id/balances/:date` | set `{balance}` (cents) / remove the end-of-day balance of that day |
| GET | `/calendars/:id/ledger?from=&to=` | days with entries and running balance (max 400 days) |
| GET | `/calendars/:id/export` | JSON snapshot `{format: "eurofish-calendar", version, calendar, events, balances}` (amounts in cents, no member e-mails) |
| POST | `/calendars/import` | body: an export file → creates a new calendar owned by the caller (201 `{calendar, events, balances}`); all-or-nothing |
| GET | `/healthz`, `/readyz` | liveness / readiness (outside `/api`) |
