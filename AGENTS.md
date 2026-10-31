# AGENTS.md - StockPilot

Rules for any human or AI contributor. Read before changing code.

## Product

StockPilot AI is a self-hostable retail operations SaaS: inventory ledger, POS,
purchasing, returns, reports, explainable reorder planner, optional AI assistant.
The core app must work with no AI key.

## Stack

- Web: React, TypeScript (strict), Vite, Tailwind, React Router, TanStack Query,
  React Hook Form + Zod, Recharts
- API: Node.js, Express, TypeScript (strict), Prisma, PostgreSQL, Zod
- Tests: Vitest, Supertest, Playwright
- Deploy: Docker Compose

## Layout

- apps/web - frontend
- apps/api - backend (routes -> validation -> services -> data access)
- docs/ - architecture, API, security, deployment, user guide, backup
- tests/e2e - Playwright tests

## Hard rules

1. Authorization is enforced on the server. Hiding a button is not security.
2. Every store-owned record has a storeId. Every query filters by it.
3. Money uses Decimal, never floating point. Totals are computed on the server.
4. Stock changes go through the inventory ledger inside a DB transaction.
5. Sales and receipts are idempotent: a retry must not apply twice.
6. Historical records are immutable snapshots; archive instead of delete.
7. Never commit secrets. Never log secrets or passwords.
8. AI may only call approved read-only, store-scoped server functions. No raw SQL.
9. No placeholder features, fake metrics, or dead buttons.
10. Do not claim a feature works until its tests have actually run and passed.

## Workflow

Small phases. After each: run lint, typecheck, tests; fix failures; update docs.

## Commands

- npm install
- npm run db:up - start PostgreSQL (Docker)
- npm run dev:api - API on :4000
- npm run dev:web - web on :5173 (proxies /api to the API)
- npm run typecheck - all workspaces
- npm test - API tests (need TEST_DATABASE_URL)
- npm run format:check
