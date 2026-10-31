CREATE TABLE "store_settings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "businessCategory" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "contactEmail" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "taxName" TEXT NOT NULL DEFAULT 'Tax',
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "receiptFooter" TEXT,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "defaultLowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_settings_storeId_key" ON "store_settings"("storeId");

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
