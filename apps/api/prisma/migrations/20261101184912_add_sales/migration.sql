-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MOBILE', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- DropIndex
DROP INDEX "purchase_orders_storeId_supplierId_idx";

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "nextSaleNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "cashierId" TEXT NOT NULL,
    "customerName" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "taxName" TEXT NOT NULL,
    "taxRatePercent" DECIMAL(5,2) NOT NULL,
    "taxInclusive" BOOLEAN NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(12,2),
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "taxTotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "lineSubtotal" DECIMAL(12,2) NOT NULL,
    "discountShare" DECIMAL(12,2) NOT NULL,
    "taxShare" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tendered" DECIMAL(12,2) NOT NULL,
    "change" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_storeId_createdAt_idx" ON "sales"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_storeId_cashierId_idx" ON "sales"("storeId", "cashierId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_storeId_number_key" ON "sales"("storeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_storeId_idempotencyKey_key" ON "sales"("storeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");

-- CreateIndex
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
