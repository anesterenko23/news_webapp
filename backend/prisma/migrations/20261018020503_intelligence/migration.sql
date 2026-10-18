-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "language" TEXT NOT NULL,
    "primarySourceId" TEXT,
    "normalizedText" TEXT NOT NULL,
    "originalJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "rawOutput" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ProcessingRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventStatus" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "publishedAt" DATETIME NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "publicationStatus" TEXT NOT NULL DEFAULT 'NeedsReview',
    "confidence" REAL NOT NULL,
    "warnings" TEXT NOT NULL,
    "duplicateCandidates" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProcessingRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "sourceCountry" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    CONSTRAINT "Relationship_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    CONSTRAINT "Evidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Evidence_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    CONSTRAINT "EventSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventSource_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewDecision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" REAL NOT NULL,
    "inputRate" REAL NOT NULL,
    "outputRate" REAL NOT NULL,
    "pricingVerifiedAt" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProcessingRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Article_fingerprint_key" ON "Article"("fingerprint");

-- CreateIndex
CREATE INDEX "ProcessingRun_articleId_createdAt_idx" ON "ProcessingRun"("articleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingRun_articleId_model_promptVersion_key" ON "ProcessingRun"("articleId", "model", "promptVersion");

-- CreateIndex
CREATE INDEX "Event_eventType_publishedAt_idx" ON "Event"("eventType", "publishedAt");

-- CreateIndex
CREATE INDEX "Event_publicationStatus_verificationStatus_idx" ON "Event"("publicationStatus", "verificationStatus");

-- CreateIndex
CREATE INDEX "EventParticipant_countryCode_idx" ON "EventParticipant"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_countryCode_key" ON "EventParticipant"("eventId", "countryCode");

-- CreateIndex
CREATE INDEX "Relationship_sourceCountry_targetCountry_type_idx" ON "Relationship"("sourceCountry", "targetCountry", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_eventId_ordinal_key" ON "Evidence"("eventId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "EventSource_eventId_articleId_key" ON "EventSource"("eventId", "articleId");

-- CreateIndex
CREATE INDEX "LlmRequest_month_status_idx" ON "LlmRequest"("month", "status");
