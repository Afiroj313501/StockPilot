-- CreateEnum
CREATE TYPE "ReorderReviewStatus" AS ENUM ('DISMISSED', 'REVIEWED', 'ORDERED');

-- CreateTable
CREATE TABLE "reorder_reviews" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ReorderReviewStatus" NOT NULL,
    "recommendedQuantity" INTEGER,
    "orderedQuantity" INTEGER,
    "purchaseOrderId" TEXT,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reorder_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reorder_reviews_storeId_productId_createdAt_idx" ON "reorder_reviews"("storeId", "productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reorder_reviews_storeId_idempotencyKey_key" ON "reorder_reviews"("storeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "reorder_reviews" ADD CONSTRAINT "reorder_reviews_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_reviews" ADD CONSTRAINT "reorder_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_reviews" ADD CONSTRAINT "reorder_reviews_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_reviews" ADD CONSTRAINT "reorder_reviews_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
