/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,repositoryId,iid]` on the table `merge_requests` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,provider,providerRepoId]` on the table `repositories` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenantId` to the `merge_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `posted_comments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `repositories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `review_check_results` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `review_runs` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "merge_requests_repositoryId_iid_key";

-- DropIndex
DROP INDEX "repositories_provider_providerRepoId_key";

-- AlterTable
ALTER TABLE "merge_requests" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "posted_comments" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "review_check_results" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "review_runs" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "merge_requests_tenantId_repositoryId_iid_key" ON "merge_requests"("tenantId", "repositoryId", "iid");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_tenantId_provider_providerRepoId_key" ON "repositories"("tenantId", "provider", "providerRepoId");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_check_results" ADD CONSTRAINT "review_check_results_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posted_comments" ADD CONSTRAINT "posted_comments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
