-- CreateTable
CREATE TABLE "check_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severityOverride" TEXT,
    "thresholds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "check_configs_tenantId_checkKey_key" ON "check_configs"("tenantId", "checkKey");

-- AddForeignKey
ALTER TABLE "check_configs" ADD CONSTRAINT "check_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

