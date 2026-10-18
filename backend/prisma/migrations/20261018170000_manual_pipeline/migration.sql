-- CreateTable
CREATE TABLE "CollectedArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "NewsBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "exportJson" TEXT NOT NULL,
    "exportedAt" DATETIME,
    "importedAt" DATETIME,
    "importChecksum" TEXT,
    "importVersion" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BatchArticle" (
    "batchId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    PRIMARY KEY ("batchId", "articleId"),
    CONSTRAINT "BatchArticle_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NewsBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BatchArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CollectedArticle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BatchReservation" (
    "articleId" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    CONSTRAINT "BatchReservation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CollectedArticle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BatchReservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NewsBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisImport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NewsBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventStatus" TEXT NOT NULL,
    "reason" TEXT,
    "publishedAt" DATETIME,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "publicationStatus" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "participantsJson" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    CONSTRAINT "ImportedEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "NewsBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportedEvent_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AnalysisImport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    CONSTRAINT "ImportedRelationship_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ImportedEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedEventSource" (
    "eventId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,

    PRIMARY KEY ("eventId", "articleId"),
    CONSTRAINT "ImportedEventSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ImportedEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportedEventSource_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CollectedArticle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectedArticle_url_key" ON "CollectedArticle"("url");

-- CreateIndex
CREATE INDEX "CollectedArticle_analysisStatus_collectedAt_idx" ON "CollectedArticle"("analysisStatus", "collectedAt");

-- CreateIndex
CREATE INDEX "CollectedArticle_source_contentHash_idx" ON "CollectedArticle"("source", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "CollectedArticle_source_sourceArticleId_key" ON "CollectedArticle"("source", "sourceArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchArticle_batchId_ordinal_key" ON "BatchArticle"("batchId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisImport_batchId_version_key" ON "AnalysisImport"("batchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedEvent_batchId_articleId_eventKey_key" ON "ImportedEvent"("batchId", "articleId", "eventKey");
