-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_storeId_createdAt_idx" ON "audit_logs"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_action_createdAt_idx" ON "audit_logs"("storeId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_resourceType_resourceId_idx" ON "audit_logs"("storeId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_actorUserId_createdAt_idx" ON "audit_logs"("storeId", "actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
