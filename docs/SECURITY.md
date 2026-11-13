# Security risks and tests

| Risk                            | Mitigation                                   | Test (phase)                             |
| ------------------------------- | -------------------------------------------- | ---------------------------------------- |
| Cross-store data access (IDOR)  | storeId on every query, membership check     | Cross-store tests on every resource (3+) |
| Role bypass via direct API call | Server-side RBAC middleware                  | Cashier hits owner endpoints -> 403 (3)  |
| Duplicate sale on retry         | Idempotency key + transaction                | Repeat POST creates one sale (7)         |
| Double stock receipt            | Receipt idempotency, remaining-qty check     | Repeat receipt rejected (6)              |
| Negative or racing stock        | Transaction + row lock                       | Concurrent sales test (5, 7)             |
| Browser-trusted totals          | Server recomputes all money                  | Tampered total ignored (7)               |
| SQL injection                   | Prisma, no raw SQL, AI has no SQL access     | Injection strings rejected (13)          |
| Secrets leakage                 | .env ignored, secret scan, no secret logging | Secret scan in CI (13)                   |
| AI data leakage                 | Approved read-only store-scoped tools only   | AI cross-store test (11)                 |
| Brute-force login               | Rate limiting                                | Lockout/429 test (3)                     |

Reporting procedure and known limitations are added in Phase 13.

## Authentication (implemented in Phase 3, chunk 4)

- Server-side sessions: random 256-bit token in an httpOnly, SameSite=Lax cookie
  (Secure in production). Only the SHA-256 hash is stored. Sessions expire after 7 days.
- Passwords hashed with bcrypt (cost 12). Login timing does not reveal whether an email exists.
- CSRF: SameSite=Lax plus Origin / Sec-Fetch-Site check on state-changing requests.
- Rate limit: 10 register/login attempts per 15 minutes per IP (in-memory; per server instance).
- Known gaps (planned): audit logging of auth events (Phase 12), password reset and
  email verification (not in the initial release), and `trust proxy` setup behind a
  reverse proxy (Phase 14).

## Authorization and tenant isolation (chunk 5)

- Active store comes from the optional `X-Store-Id` header, resolved only against the
  caller's own memberships. A missing or foreign store ID returns the same 403.
- Roles are ranked CASHIER < MANAGER < OWNER and enforced by `requireRole` on the server.
- Queries on store-owned data must always include the `storeId` from the verified store
  context, never an ID taken from the request. A lookup scoped to the store turns another
  store's record into not found.
- User management is owner-only. Owners cannot change their own role or another owner's
  role, and OWNER cannot be assigned through the API.
- Known limitations: an email belongs to one account (no multi-store membership yet);
  no user deactivation endpoint yet; role and user changes are not audit-logged until
  Phase 12.

## Catalog authorization (chunk 8)

- Every product and category query includes the `storeId` from the verified store
  context. Updates and deletes scope both ID and store, so another store's record
  is not found.
- Category IDs in requests are checked against the caller's store before use.
- Request bodies are strict; `storeId`, `stockQuantity`, and unknown keys are rejected.
- Sorting by cost is not offered, so cashiers cannot infer cost order.

## Inventory ledger (chunk 9)

- All inventory endpoints require MANAGER or OWNER and a verified store context.
- Product lookups are scoped by `storeId`; another store's product ID returns 404.
- Request bodies are strict: `storeId`, `quantityBefore`, and `actorUserId` are
  rejected.
- Row locking and idempotency keys prevent overselling and double-applied retries.
- A database trigger does not yet block direct SQL edits to `stock_movements`;
  `GET /inventory/integrity` detects drift between the ledger and product quantities.

## Receiving (chunk 12)

- Receiving requires MANAGER or OWNER and a verified store context; the order lookup is scoped by
  storeId (another store's order is 404). Request bodies are strict.
- Row locking (order, then products in id order) and idempotency keys prevent double-applied or
  over-received stock (covered by concurrency tests, including receive versus cancel).
- Stock changes from receiving always go through the ledger, so `GET /inventory/integrity` still reconciles.

## Point of sale (chunk 13)

- Totals are never accepted from the browser: bodies are strict, so `total`, `unitPrice`, `storeId`,
  `cashierId` and similar fields are rejected. `expectedTotal` is only a safety check (409 on mismatch).
- Product lookups are scoped by storeId (another store's product is "invalid"); sale reads are scoped
  by storeId, and cashiers are further limited to their own sales (404 otherwise).
- Row locks plus idempotency keys prevent overselling and double sales (covered by concurrency tests).
- Discounts require MANAGER or OWNER. Known gap: no configurable cashier discount limit yet.

## Returns (chunk 14)

- Every returns endpoint requires MANAGER or OWNER and a verified store context (checked before any
  validation or database access); cashiers get 403 everywhere.
- Sale lookups are scoped by storeId (another store's sale is 404). Request bodies are strict, so
  `refundTotal`, `refundAmount`, `storeId` and similar fields are rejected; refunds are always
  calculated by the server from the sale's saved figures.
- A row lock on the sale plus idempotency keys prevent over-returning and double refunds (covered by
  concurrency tests). Damaged items cannot be restocked through the API.

## Reports and exports (chunk 15)

- All report and export endpoints require MANAGER or OWNER and a verified store context (checked
  before validation or database access); cashiers get 403. Every query is scoped by storeId.
- Report queries use parameterised SQL only; the time zone and dates are bound parameters.
- CSV exports neutralise spreadsheet formulas in text cells. Known gap: exports are not audit-logged
  until Phase 12.

## AI assistant (chunk 17)

- Endpoints require MANAGER or OWNER and a verified store context (checked before the rate limiter,
  validation or any lookup). Rate limit: 20 questions per user per 15 minutes.
- The model only reaches data through eight read-only lookups that re-check the role, validate strictly
  and use the caller's store (covered by tests for other-store product ids, extra `storeId` parameters,
  unknown tools and invalid values). There is no SQL access.
- Model output is validated and grounded against the lookup results; failures fall back to built-in answers.
- The API key is read from the environment only; it is not sent to the browser, returned or logged.
  Provider errors are mapped to fixed messages and never include provider response bodies.
- Known risks: prompt injection through product names is mitigated (cleaning, data-not-instructions
  prompt, no write access, grounding check) but not impossible; external providers see product and sales
  figures (documented in docs/AI.md).

## Audit log (chunk 18)

- Viewing requires OWNER and a verified store context (checked before any query); entries are scoped by storeId.
- The log is append-only: no write endpoints, database triggers reject UPDATE, DELETE and TRUNCATE
  (covered by tests, including direct SQL).
- Secrets are never stored: passwords, tokens and keys do not reach the entry builders, metadata is sanitised,
  and tests check that passwords and session tokens appear nowhere in the table.
- Known gaps: fail-open writes (a logging problem cannot block a sale), 403s are not logged, the table owner
  can bypass the triggers, and there is no retention policy (see docs/AUDIT.md).

## CSV import and export (chunk 19)

- Export, check and import require MANAGER or OWNER and a verified store context (checked before the body is read);
  everything is scoped by storeId. The import router is mounted before the products router, with guards on each route,
  so other product routes keep their own permissions (covered by a test).
- Input limits: 750,000 characters, 2,000 rows, 20 columns, 1 MB body (clean 413), per-user rate limit.
- The file is parsed by our own parser and never executed. Text cells starting with a formula character are
  neutralised on export, and only that exact guard is removed on import.
- The import re-validates on the server and is all-or-nothing in one transaction under a per-store advisory lock;
  it can never write stock, and imports and exports are audit-logged.
