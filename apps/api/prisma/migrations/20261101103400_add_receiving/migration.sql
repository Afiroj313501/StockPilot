ALTER TABLE "products"
  ADD COLUMN "averageCost" DECIMAL(12,4);

CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_receipts_storeId_idempotencyKey_key"
  ON "purchase_receipts"("storeId", "idempotencyKey");
CREATE INDEX "purchase_receipts_purchaseOrderId_idx"
  ON "purchase_receipts"("purchaseOrderId");
CREATE INDEX "purchase_receipt_items_receiptId_idx"
  ON "purchase_receipt_items"("receiptId");
CREATE INDEX "purchase_receipt_items_productId_idx"
  ON "purchase_receipt_items"("productId");

ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
