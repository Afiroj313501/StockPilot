# Audit log

A permanent record of important actions, visible only to the store owner (Audit log screen,
`GET /api/v1/audit-logs`).

## What is recorded

Each entry: time, actor (name and role copied at that moment), action, resource type and id, a short
summary, small safe metadata, and the request id. Actions:
sign-in events (account created, sign-in, sign-out, failed sign-in for an existing account),
user created and role changed, settings changed, category/product/supplier changes (including
archive and restore), stock movements, purchase orders (create, edit, submit, approve, cancel, receive),
reorder planner decisions, sales, returns and CSV exports.

## What is never recorded

Passwords, tokens, API keys, request bodies, email addresses, IP addresses, AI question text,
and the values of free-text settings such as address, phone or receipt footer.
Request field NAMES are recorded; values only for quantities of stock movements and a short allowlist of settings
(currency, time zone, tax name/rate/inclusive, negative-stock rule, default thresholds).
A second safety net (`sanitize.ts`) drops metadata keys that look like secrets.

## How entries are written

A middleware wraps every POST, PATCH, PUT, DELETE (and CSV exports). For a SUCCESSFUL response (2xx),
`rules.ts` turns the method, path, request field names and response into an action and a summary,
and the entry is written BEFORE the response is sent. Repeated (idempotent replay) requests, failed
requests, forbidden requests and plain reads are not recorded. Sign-in events are written by the auth routes.
To audit a new action, add a rule to `rules.ts` and its label to `actions.ts`.

## Protection against change

- There is no endpoint that edits or deletes entries.
- Database triggers reject UPDATE, DELETE and TRUNCATE on `audit_logs`. Only a transaction that sets
  `stockpilot.audit_maintenance = 'on'` can bypass them; only the test reset helper does.
- Restrictive foreign keys prevent deleting a user or store that has entries.
- A database superuser or the table owner can still disable the triggers: protect database credentials and keep backups.

## Limits

- Entries are written after the action's own transaction, not inside it. If the audit write fails the request
  still succeeds and an error is logged (fail-open), so very rarely an action can lack an entry.
- Denied requests (403) and viewing data (other than exports) are not recorded. Unknown-email sign-ins are only
  a server warning.
- No IP address or browser details. No retention policy: the table grows; archive it with your normal backups.
- A deleted product's entry says "Deleted a product" because its name no longer exists at that point.
