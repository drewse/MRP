-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRepoId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_requests" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "iid" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sourceBranch" TEXT NOT NULL,
    "targetBranch" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "webUrl" TEXT NOT NULL,
    "lastSeenSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_runs" (
    "id" TEXT NOT NULL,
    "mergeRequestId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "summary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_check_results" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "filePath" TEXT,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "evidence" TEXT,
    "suggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posted_comments" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filePath" TEXT,
    "line" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posted_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_provider_providerRepoId_key" ON "repositories"("provider", "providerRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "merge_requests_repositoryId_iid_key" ON "merge_requests"("repositoryId", "iid");

-- AddForeignKey
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_mergeRequestId_fkey" FOREIGN KEY ("mergeRequestId") REFERENCES "merge_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_check_results" ADD CONSTRAINT "review_check_results_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posted_comments" ADD CONSTRAINT "posted_comments_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
