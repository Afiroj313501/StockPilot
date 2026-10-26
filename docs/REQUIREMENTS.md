# Requirements Matrix

Source key:

- **VIBE96-UNVERIFIED** - from the brief, but not yet confirmed against Vibe96's official seller page.
- **PRODUCT** - our own quality goal.

Nothing is marked "officially verified" until we read Vibe96's current seller docs (Phase 16).

## P0 - must have

| ID    | Requirement                                        | Source            | Phase |
| ----- | -------------------------------------------------- | ----------------- | ----- |
| P0-1  | Secure auth (hashing, sessions, rate limits, CSRF) | PRODUCT           | 3     |
| P0-2  | Server-side RBAC (owner / manager / cashier)       | PRODUCT           | 3     |
| P0-3  | Strict tenant isolation + cross-store tests        | PRODUCT           | 3     |
| P0-4  | Products and categories                            | PRODUCT           | 5     |
| P0-5  | Inventory ledger (transactional, idempotent)       | PRODUCT           | 5     |
| P0-6  | Suppliers, purchase orders, receiving              | PRODUCT           | 6     |
| P0-7  | POS, sales, payments, receipts                     | PRODUCT           | 7     |
| P0-8  | Returns and financial reconciliation               | PRODUCT           | 8     |
| P0-9  | Reports consistent with dashboard                  | PRODUCT           | 9     |
| P0-10 | Explainable deterministic reorder planner          | PRODUCT           | 10    |
| P0-11 | Optional AI assistant with no-key fallback         | PRODUCT           | 11    |
| P0-12 | Migrations, validation, error handling             | PRODUCT           | 2-13  |
| P0-13 | Automated tests for critical rules                 | PRODUCT           | 13    |
| P0-14 | Reproducible install, Docker + 2nd deploy route    | VIBE96-UNVERIFIED | 14    |
| P0-15 | Full documentation                                 | VIBE96-UNVERIFIED | 15    |
| P0-16 | Live demo + 5 screenshots (1920x1080)              | VIBE96-UNVERIFIED | 15    |
| P0-17 | Licence review, clean source archive               | VIBE96-UNVERIFIED | 16    |

## P1 - should have

CSV import/export, printable receipts, audit logs, backup/restore docs, CI,
API docs, responsive UI, sample data, onboarding, branding settings,
changelog, troubleshooting guide, demo video.

## P2 - optional

Multi-warehouse, seasonal forecasting, OCR, extra languages, PWA,
accounting integrations, payment gateways, billing.
