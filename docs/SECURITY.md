# Security

StockPilot AI is multi-user retail software that holds business data, so security is part of every feature.
This document describes what the product does, how it is verified, and what it does NOT do.

## Reporting a vulnerability

Report security problems privately to **SECURITY_CONTACT** (replace this placeholder with your real contact
before release). Please include steps to reproduce and do not publish details until a fix is available.

## Authentication and sessions

- Sign-in with email and password. Passwords are hashed with bcrypt (cost 12), 10 to 72 characters.
- A session is a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production, so it needs HTTPS).
  Only the SHA-256 hash of the token is stored. Sessions last 7 days; logout deletes the session on the server.
- Sign-in answers are identical for an unknown email and a wrong password, with similar timing.
- Throttling: register and sign-in are limited per IP; **failed** sign-ins are also limited per account
  (default 10 per 15 minutes). Successful sign-ins never count.
- Owners manage staff accounts: create, change role, deactivate (sessions end at once) and reset a password (a random temporary password, shown once, which must be changed at the next sign-in). Anyone can change their own password, which ends their other sessions (10 attempts per 15 minutes). An operator command recovers a forgotten owner password ([USER_MANAGEMENT.md](./USER_MANAGEMENT.md)).
- Not included in the initial release: two-factor sign-in, email-based password reset, email verification, idle timeout.

## Authorization (roles)

Roles: CASHIER < MANAGER < OWNER, enforced **on the server** for every route (hiding a button is not security).

| Area                                                                                                                   | Lowest role |
| ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| Point of sale, own sales, product list (cost hidden), store settings (read)                                            | Cashier     |
| Products, categories, suppliers, stock, purchasing, returns, reports, reorder planner, AI assistant, CSV import/export | Manager     |
| Approve purchase orders, delete products, store settings (change), users and roles, audit log                          | Owner       |

A test lists every route of the API with its minimum role and fails if a route is added without being listed
([routeMatrix.test.ts](../apps/api/src/test/routeMatrix.test.ts)). It also proves each route refuses lower roles and unauthenticated calls.

## Tenant isolation

Every store-owned row has a `storeId`. The active store is resolved only from the caller's own memberships;
a forged `X-Store-Id` gets 403. Queries always include the verified store id, so another store's record is
"not found" (404). Ids inside request bodies (categories, suppliers, products, sales) are checked against the caller's store.
[isolation.matrix.test.ts](../apps/api/src/test/isolation.matrix.test.ts) has a second store attack every id-based route of the first.

## Data integrity

- Money: exact decimals (database `Decimal`, integer cents in calculations); totals, tax and refunds are computed on the server.
- Stock: every change goes through the append-only-style inventory ledger inside a transaction with row locks.
- Idempotency keys make retries and double clicks safe (sales, receipts, returns, stock movements, planner drafts).
- Historical records are snapshots; products and suppliers are archived, not deleted; database foreign keys restrict deletion.

## Input validation and files

- Every request body is validated with strict schemas (unknown fields are rejected, so `storeId`, totals or stock cannot be injected).
- CSV import: 750,000 characters, 2,000 rows, 20 columns; two-step (check, then all-or-nothing import);
  stock is never imported; formula-looking text is neutralised on export. Bodies over 1 MB get HTTP 413.
- SQL: Prisma, plus raw queries only as parameterised tagged templates (a test enforces this).
- Browser: React escapes output; no `dangerouslySetInnerHTML`, `eval` or browser storage (a test enforces this).

## Abuse protection

| Endpoint group                      | Limit                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| Register, sign-in                   | 10 per 15 min per IP; 10 failed per 15 min per account |
| Reports, reorder planner, audit log | 300 per 15 min per user                                |
| AI assistant questions              | 20 per 15 min per user                                 |
| CSV check and import                | 20 per 15 min per user                                 |

Limits are kept in memory per API instance (they reset on restart and are not shared across instances).
Behind a reverse proxy set `TRUST_PROXY=1` so limits use the real client address.

## Browser security

- Helmet headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Referrer-Policy`); `X-Powered-By` removed.
- CORS allows only `WEB_ORIGIN`, with credentials.
- CSRF: `SameSite=Lax` cookie plus an `Origin` / `Sec-Fetch-Site` check on every state-changing request.
- Every API response carries `Cache-Control: no-store`.
- Errors return a safe code, message and request id; stack traces and database errors are never returned.

## Secrets and configuration

- Secrets come from environment variables, validated at start-up (invalid configuration stops the server and names the
  variable, never its value). `.env` is git-ignored; `.env.example` holds placeholders only.
- Never logged: passwords, session tokens, cookies, authorization headers, API keys, AI question text.
- `npm run scan:secrets` scans tracked files; CI runs it on every push.

## AI assistant

Optional. Read-only, store-scoped lookups only; no SQL access; model output is validated and every number is checked
against the lookup results. With a provider configured, the question and lookup results (product names, SKUs, sales and
stock figures) are sent to that provider; staff and customer names, emails and the store name are not. See [AI.md](./AI.md).

## Audit log

Append-only (no endpoints, plus database triggers that reject UPDATE, DELETE and TRUNCATE), owner-only, scoped by store;
never stores secrets or request bodies. See [AUDIT.md](./AUDIT.md).

## Dependencies and supply chain

`package-lock.json` is committed. Before each release run `npm audit --omit=dev`, `npm run scan:secrets` and a licence check, and
record the results in [SECURITY_REVIEW.md](./SECURITY_REVIEW.md). CI fails on high or critical vulnerabilities in production dependencies.

## Known limitations and accepted risks

- No two-factor sign-in, email-based password reset or email verification; sessions last 7 days without an idle timeout and cannot be
  revoked all at once.
- CSRF relies on `SameSite=Lax` and the origin check rather than per-request tokens.
- A per-account sign-in limit lets an attacker lock an account for up to 15 minutes.
- Rate limits are per instance and in memory.
- Audit entries are written after the action's own transaction (a failure to write is logged, not fatal), and the database
  owner can disable the audit triggers: protect database credentials and keep backups.
