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

## Inventory ledger (chunk 9)

- `StockMovement` records every stock change: type, signed `quantityChange`,
  `quantityBefore`, `quantityAfter`, reason, actor and a per-store unique
  `idempotencyKey`.
- `Product.stockQuantity` changes only inside `recordMovement`, in one transaction
  that first locks the product row (`SELECT ... FOR UPDATE`).
- Idempotent retries return the original movement with HTTP 200 and
  `Idempotent-Replayed: true`; reusing a key for another product or type returns
  `409 IDEMPOTENCY_KEY_REUSED`.
- Negative stock is refused with `409 INSUFFICIENT_STOCK` unless the store setting
  allows it.
- The API supports `OPENING`, signed `ADJUSTMENT`, `DAMAGED`, `LOST`, and
  `RECONCILIATION`. `RECEIPT`, `SALE`, and `RETURN` are reserved for purchasing,
  POS, and returns code.
- Manager and owner endpoints provide movement history, low-stock products, and
  ledger integrity checks. Movements cannot be updated or deleted; corrections are
  new movements.

## Web: catalog and inventory screens (chunk 10)

- `/products` is available to all roles and is read-only for cashiers. Product
  forms, `/categories`, and `/inventory` are manager-and-owner surfaces.
  Route guards are convenience only; the API enforces roles.
- Server state lives in TanStack Query (`['products', ...]`, `['categories']`,
  and `['inventory', ...]`). Stock changes invalidate products and inventory.
- Stock is never edited in the product form. Adjust stock posts to
  `/inventory/movements` with an idempotency key reused only for identical
  retries.
- Dialogs use the native `<dialog>` element for browser focus trapping and Esc
  handling.

## Suppliers and purchase orders (chunk 11)

- Suppliers are store-scoped and manager-and-owner accessible. They are archived
  with `isActive=false`; archived suppliers cannot be used for new orders.
- Purchase orders use `DRAFT -> SUBMITTED -> APPROVED`, with `CANCELLED`
  allowed from any pre-receiving state. Only owners can approve.
- Order numbers are allocated by a locked per-store counter in the creation
  transaction, so failed creates do not consume numbers.
- Line quantities and costs are validated server-side. Totals use Decimal
  arithmetic and are returned as strings; receiving fields remain zero until
  the receiving chunk.

## Receiving stock and cost (chunk 12)

- `POST /purchases/:id/receive` (manager+) on an APPROVED or PARTIALLY_RECEIVED order. Body:
  `{ idempotencyKey, note?, items: [{ productId, quantity }] }`.
- One transaction: lock the order row, then the products in id order; write `PurchaseReceipt`,
  `PurchaseReceiptItem`, increment `quantityReceived`, update `Product.stockQuantity` and
  `averageCost`, write a `RECEIPT` `StockMovement` (referenceType PURCHASE_RECEIPT), then set the
  order to RECEIVED (all lines complete) or PARTIALLY_RECEIVED.
- Only the received quantity changes stock. A line can never exceed ordered minus received (409
  `OVER_RECEIPT`). A repeated `idempotencyKey` returns the original result (HTTP 200,
  `Idempotent-Replayed: true`); the same key on another order is 409.
- Cost method: moving weighted average. `new = (onHand * avg + received * unitCost) / (onHand + received)`,
  rounded half up to 4 decimals. With `onHand <= 0` the new average is the receipt cost. `avg` starts
  as the product's `costPrice` when no average exists. `costPrice` itself is never changed by receiving.
  Reports (Phase 9) use `averageCost`, falling back to `costPrice`.
- Receipts snapshot the order line's unit cost. Orders that received stock cannot be cancelled.
- Web: `/purchases`, `/purchases/new`, `/purchases/:id`, `/purchases/:id/edit` (manager+).
- Limits: no per-delivery cost override, no "close short" action, no printing, `averageCost` not
  shown in the UI yet.
