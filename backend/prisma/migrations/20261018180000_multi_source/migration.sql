-- CreateTable
CREATE TABLE "NewsSourceState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL,
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "checkpointJson" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "optionsJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "CollectorLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CollectedArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT,
    "publisher" TEXT NOT NULL DEFAULT '',
    "canonicalUrl" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "categoriesJson" TEXT NOT NULL DEFAULT '[]',
    "regionsJson" TEXT NOT NULL DEFAULT '[]',
    "primaryRegion" TEXT NOT NULL DEFAULT 'Unknown',
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "relevanceHint" TEXT NOT NULL DEFAULT 'unclassified',
    "extractionMethod" TEXT NOT NULL DEFAULT 'legacy',
    "extractionStatus" TEXT NOT NULL DEFAULT 'legacy',
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceArticleId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author" TEXT,
    "language" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentStatus" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "originalJson" TEXT NOT NULL,
    "analysisStatus" TEXT NOT NULL DEFAULT 'collected',
    "analyzedAt" DATETIME,
    "analysisBatchId" TEXT,
    "analysisVersion" INTEGER NOT NULL DEFAULT 0,
    "analysisResultId" TEXT
);
INSERT INTO "new_CollectedArticle" ("analysisBatchId", "analysisResultId", "analysisStatus", "analysisVersion", "analyzedAt", "author", "collectedAt", "content", "contentHash", "contentStatus", "id", "language", "originalJson", "publishedAt", "source", "sourceArticleId", "sourceUrl", "title", "url") SELECT "analysisBatchId", "analysisResultId", "analysisStatus", "analysisVersion", "analyzedAt", "author", "collectedAt", "content", "contentHash", "contentStatus", "id", "language", "originalJson", "publishedAt", "source", "sourceArticleId", "sourceUrl", "title", "url" FROM "CollectedArticle";
DROP TABLE "CollectedArticle";
ALTER TABLE "new_CollectedArticle" RENAME TO "CollectedArticle";
CREATE UNIQUE INDEX "CollectedArticle_canonicalUrl_key" ON "CollectedArticle"("canonicalUrl");
CREATE UNIQUE INDEX "CollectedArticle_url_key" ON "CollectedArticle"("url");
CREATE INDEX "CollectedArticle_analysisStatus_collectedAt_idx" ON "CollectedArticle"("analysisStatus", "collectedAt");
CREATE INDEX "CollectedArticle_source_contentHash_idx" ON "CollectedArticle"("source", "contentHash");
CREATE INDEX "CollectedArticle_sourceId_publishedAt_idx" ON "CollectedArticle"("sourceId", "publishedAt");
CREATE INDEX "CollectedArticle_primaryRegion_publishedAt_idx" ON "CollectedArticle"("primaryRegion", "publishedAt");
CREATE INDEX "CollectedArticle_analysisStatus_priorityScore_idx" ON "CollectedArticle"("analysisStatus", "priorityScore");
CREATE INDEX "CollectedArticle_publisher_contentHash_idx" ON "CollectedArticle"("publisher", "contentHash");
CREATE UNIQUE INDEX "CollectedArticle_source_sourceArticleId_key" ON "CollectedArticle"("source", "sourceArticleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
