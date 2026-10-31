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
