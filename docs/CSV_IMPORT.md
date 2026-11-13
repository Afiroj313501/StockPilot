# Products CSV import and export

Manager and owner only. Screens: Products > Import CSV / Export CSV.

## Export (`GET /api/v1/products/export?status=active|archived|all`)

UTF-8 CSV with a byte-order mark and CRLF line endings. Columns:
sku, name, barcode, category, unit, description, costPrice, sellingPrice, stockQuantity, reorderThreshold, status.
Text starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'` so a spreadsheet cannot run it
as a formula. At most 50,000 rows. Stock and status are informational: the import ignores them.

## Import: two steps

1. **Check** `POST /api/v1/products/import/preview` with `{ csv, existing: "skip" | "update" }`: returns a
   report and writes nothing.
2. **Import** `POST /api/v1/products/import` with the same body: checks the file **AGAIN on the server** (it never
   trusts a previous check) and applies it in one transaction. Any problem (HTTP 422, with the report) means
   nothing is written, not even categories. A conflict created by another change while importing rolls
   everything back (HTTP 409 `IMPORT_CONFLICT`).

## Format

- Comma, semicolon or tab; UTF-8 with or without BOM; quoted values may contain delimiters and line breaks.
- Limits: 750,000 characters, 2,000 data rows, 20 columns, 100 new categories per import. A request body over
  1 MB gets HTTP 413.
- Columns (case-insensitive; common alternatives such as `Price`, `Product Name`, `EAN` are recognized):
  `sku` (required), `name`, `costPrice`, `sellingPrice` (these three required for a NEW product), `barcode`,
  `category`, `unit`, `description`, `reorderThreshold`. Unknown columns are ignored and listed.
- Rules: SKU is stored in capitals; prices are plain amounts with at most 2 decimals; a SKU or barcode may appear
  only once in the file; a barcode already used by another product is a problem; blank cells leave existing values alone.
- **Stock is never imported.** Columns such as stock or quantity are ignored. Use Adjust stock so the ledger stays true.
- A leading `'` before `=`, `+`, `-`, `@` is removed on import (it is the export's formula guard).

## Existing SKUs

`skip` (default) leaves existing products untouched. `update` changes only the columns that have a value.
Repeating an import cannot create duplicates: imports for one store run one at a time and SKUs are unique.

## Limits

No `.xlsx` files; blanks cannot clear a value; no images or supplier links; quotes inside an unquoted value are rejected.
