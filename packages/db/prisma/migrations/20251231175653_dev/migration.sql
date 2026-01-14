-- AlterTable
ALTER TABLE "knowledge_sources" ALTER COLUMN "type" DROP DEFAULT,
ALTER COLUMN "provider" DROP DEFAULT,
ALTER COLUMN "title" DROP DEFAULT,
ALTER COLUMN "contentText" DROP DEFAULT,
ALTER COLUMN "contentHash" DROP DEFAULT;

-- AlterTable
ALTER TABLE "posted_comments" ADD COLUMN     "aiIncluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiSummaryHash" TEXT;

-- CreateTable
CREATE TABLE "tenant_ai_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'OPENAI',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "maxSuggestions" INTEGER NOT NULL DEFAULT 5,
    "maxPromptChars" INTEGER NOT NULL DEFAULT 6000,
    "maxTotalDiffBytes" INTEGER NOT NULL DEFAULT 40000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ai_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "suggestedFix" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ai_configs_tenantId_key" ON "tenant_ai_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_ai_configs" ADD CONSTRAINT "tenant_ai_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
