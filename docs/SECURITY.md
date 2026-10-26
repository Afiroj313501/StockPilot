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
