# Architecture

## Store settings (chunk 7)

- One `StoreSetting` row per store contains currency, time zone, tax, stock policy,
  and receipt footer settings. It is created at registration and lazily created
  for older stores.
- Any member may read settings; only an OWNER may change them. Unknown fields are
  rejected.
- Currency (ISO 4217) and time zone (IANA, stored canonically) are validated
  server-side.
- Tax rate is stored as `Decimal(5,2)` and transported as a string.
- Sales and receipts must snapshot tax name, rate, and currency at sale time so
  changing settings never rewrites history.
