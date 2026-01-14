-- AlterTable: Update KnowledgeSource model
-- Drop old columns if they exist (safe for new installs)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'bucket') THEN
        ALTER TABLE "knowledge_sources" DROP COLUMN "bucket";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'name') THEN
        ALTER TABLE "knowledge_sources" DROP COLUMN "name";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'description') THEN
        ALTER TABLE "knowledge_sources" DROP COLUMN "description";
    END IF;
END $$;

-- Add new columns (only if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'type') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'DOC';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'provider') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'LOCAL';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'providerId') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "providerId" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'title') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'sourceUrl') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "sourceUrl" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'contentText') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "contentText" TEXT NOT NULL DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'contentHash') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_sources' AND column_name = 'metadata') THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "metadata" JSONB;
    END IF;
END $$;

-- Drop old indexes if they exist
DROP INDEX IF EXISTS "knowledge_sources_tenantId_type_provider_providerId_key";
DROP INDEX IF EXISTS "knowledge_sources_tenantId_contentHash_key";

-- CreateIndex (unique constraint with partial index for nullable providerId)
-- Note: Prisma will create the unique constraint, but we need a partial index for nullable columns
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_tenantId_type_provider_providerId_key" 
    ON "knowledge_sources"("tenantId", "type", "provider", COALESCE("providerId", '')) 
    WHERE "providerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_tenantId_contentHash_key" 
    ON "knowledge_sources"("tenantId", "contentHash");

