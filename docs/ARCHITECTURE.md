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

## Catalog (chunk 8)

- `Category` names are unique per store, with case-insensitive service checks.
  `Product` SKUs are unique per store and stored uppercase; barcodes are unique
  per store when present.
- Money uses `Decimal(12,2)`, sent as numbers with at most two decimals and
  returned as strings.
- `stockQuantity` is read-only through the API. Only the inventory ledger changes
  it.
- Archiving (`isActive=false`) is the normal way to retire a product. Deleting
  is owner-only and is blocked when history references the product.
- Cost price is hidden from cashiers. Stock is whole units only; images, supplier
  links, and CSV import/export are deferred.
