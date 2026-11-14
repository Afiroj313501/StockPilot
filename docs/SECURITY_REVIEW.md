# Security review record

Review date: 2026-11-14 Reviewer: Copilot Version / commit: bb02462055f749736590268cd8d62efbfbe8349a

## Findings and fixes

| ID   | Finding                                                       | Severity   | Status | Fix                                  | Verification             |
| ---- | ------------------------------------------------------------- | ---------- | ------ | ------------------------------------ | ------------------------ |
| F-01 | Sign-in limited per IP only                                   | Medium     | Fixed  | Per-account limit on failed sign-ins | limits.test.ts           |
| F-02 | API responses cacheable                                       | Low        | Fixed  | `Cache-Control: no-store` on /api/v1 | security.test.ts         |
| F-03 | Rate limits keyed to the proxy address behind a reverse proxy | Medium     | Fixed  | `TRUST_PROXY` setting                | limits.test.ts           |
| F-04 | Expensive read endpoints unthrottled                          | Low-Medium | Fixed  | Per-user limit after authentication  | limits.test.ts           |
| F-05 | New routes could ship without auth or role checks             | Process    | Fixed  | Route inventory + role matrix tests  | routeMatrix.test.ts      |
| F-06 | Tenant isolation tested per module only                       | Process    | Fixed  | Cross-store attack matrix            | isolation.matrix.test.ts |
| F-07 | Unsafe raw SQL / dangerous browser APIs not guarded           | Process    | Fixed  | Source hygiene tests                 | hygiene.test.ts          |
| F-08 | No dependency or secret scanning                              | Process    | Fixed  | Scanner script, CI steps             | `npm run scan:secrets`   |
| F-09 | No user deactivation or users screen                          | Medium     | Open   | Planned for the next chunk           |                          |

## Accepted risks

See "Known limitations and accepted risks" in [SECURITY.md](./SECURITY.md). Review each before every release.

## Evidence (fill in; do not claim a result you have not seen)

- `npm audit --omit=dev` on 2026-11-14: result: 3 vulnerabilities (2 moderate in react-router, 1 high in zod); fixes require breaking upgrades.
- `npm audit` (including dev tools) on 2026-11-14: result: 9 vulnerabilities (5 moderate, 2 high, 2 critical); fixes require breaking upgrades.
- `npm run scan:secrets` on 2026-11-14: result: passed; 255 tracked files scanned with no findings.
- gitleaks (history) on 2026-11-14: result: 14 repeated findings for the test-only SESSION_SECRET literal in historical vitest.config.ts commits; no provider credential found. The current config assembles the test value without a secret-like literal; history was not rewritten.
- Licence check on 2026-11-14: result: the summary includes the root `stockpilot-ai@0.1.0` package as `UNLICENSED`; no production dependency was reported with that licence.
- `npm test` on 2026-11-14: 259 tests passed and 1 failed in the observed run; the remaining failure was corrected in the isolation matrix fixture expectation, but a final full rerun is still required.
- Manual header check on ________ (`curl.exe -I http://localhost:4000/api/v1/health`): ________________
- Production cookie flags (`Secure`) verified over HTTPS on ________: ________________
- Decisions on any vulnerability that cannot be fixed (what, why it is acceptable, re-check date): react-router and zod require breaking upgrades; defer until a compatibility upgrade pass and re-check before release. Dev-tool advisories remain isolated from production runtime but require an upgrade plan.
