-- CreateTable
CREATE TABLE "ExtractedClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legacyEventId" TEXT,
    "runId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "canonicalEventId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventStatus" TEXT NOT NULL,
    "actionText" TEXT NOT NULL,
    "objectText" TEXT,
    "occurredAt" DATETIME,
    "publishedAt" DATETIME NOT NULL,
    "confidence" REAL NOT NULL,
    "rawClaim" TEXT NOT NULL,
    "entities" TEXT NOT NULL DEFAULT '[]',
    "validationStatus" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'NotAssessed',
    "publicationStatus" TEXT NOT NULL,
    "validationResults" TEXT NOT NULL,
    "reviewReasons" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractedClaim_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProcessingRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExtractedClaim_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExtractedClaim_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "attributionEvidenceIds" TEXT NOT NULL,
    CONSTRAINT "ClaimParticipant_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "temporaryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "quoteMatch" TEXT NOT NULL,
    "semanticSupport" TEXT NOT NULL DEFAULT 'NotAssessed',
    "sourceVerification" TEXT NOT NULL DEFAULT 'NotAssessed',
    CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "sourceCountry" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "evidenceIds" TEXT NOT NULL,
    "referenceIntegrity" TEXT NOT NULL,
    CONSTRAINT "ClaimRelationship_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimEvidenceLink" (
    "relationshipId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,

    PRIMARY KEY ("relationshipId", "evidenceId"),
    CONSTRAINT "ClaimEvidenceLink_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClaimRelationship" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClaimEvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ClaimEvidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanonicalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventStatus" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "publishedAt" DATETIME NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "publicationStatus" TEXT NOT NULL DEFAULT 'NeedsReview',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CanonicalParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalEventId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "CanonicalParticipant_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalEventId" TEXT NOT NULL,
    "originClaimId" TEXT NOT NULL,
    "sourceCountry" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "evidenceIds" TEXT NOT NULL,
    CONSTRAINT "EventRelationship_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanonicalEventSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalEventId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publisher" TEXT NOT NULL,
    "originalSource" TEXT,
    "syndicationSource" TEXT,
    "primaryDocument" TEXT,
    "lineageId" TEXT,
    "independenceStatus" TEXT NOT NULL DEFAULT 'Unknown',
    "linkReason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalEventSource_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanonicalEventSource_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanonicalEventSource_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MergeCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "canonicalEventId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "reasons" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reviewer" TEXT,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MergeCandidate_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MergeCandidate_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalEventId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventRevision_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalEventId" TEXT NOT NULL,
    "assessor" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "sourceIndependence" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationDecision_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentFingerprint" TEXT NOT NULL DEFAULT '',
    "originalSource" TEXT,
    "syndicationSource" TEXT,
    "primaryDocument" TEXT,
    "lineageId" TEXT
);
INSERT INTO "new_Article" ("canonicalUrl", "content", "createdAt", "fingerprint", "id", "language", "normalizedText", "originalJson", "primarySourceId", "publishedAt", "source", "title", "url") SELECT "canonicalUrl", "content", "createdAt", "fingerprint", "id", "language", "normalizedText", "originalJson", "primarySourceId", "publishedAt", "source", "title", "url" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_fingerprint_key" ON "Article"("fingerprint");
CREATE TABLE "new_ProcessingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "retryOf" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "rawOutput" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "reviewReasons" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "ProcessingRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProcessingRun" ("articleId", "attempt", "createdAt", "durationMs", "error", "finishedAt", "id", "model", "promptVersion", "rawOutput", "retryOf", "status", "warnings") SELECT "articleId", "attempt", "createdAt", "durationMs", "error", "finishedAt", "id", "model", "promptVersion", "rawOutput", "retryOf", "status", "warnings" FROM "ProcessingRun";
DROP TABLE "ProcessingRun";
ALTER TABLE "new_ProcessingRun" RENAME TO "ProcessingRun";
CREATE INDEX "ProcessingRun_articleId_createdAt_idx" ON "ProcessingRun"("articleId", "createdAt");
CREATE UNIQUE INDEX "ProcessingRun_articleId_model_promptVersion_attempt_key" ON "ProcessingRun"("articleId", "model", "promptVersion", "attempt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedClaim_legacyEventId_key" ON "ExtractedClaim"("legacyEventId");

-- CreateIndex
CREATE INDEX "ExtractedClaim_validationStatus_publicationStatus_idx" ON "ExtractedClaim"("validationStatus", "publicationStatus");

-- CreateIndex
CREATE INDEX "ExtractedClaim_articleId_runId_idx" ON "ExtractedClaim"("articleId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimParticipant_claimId_countryCode_key" ON "ClaimParticipant"("claimId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidence_claimId_temporaryId_key" ON "ClaimEvidence"("claimId", "temporaryId");

-- CreateIndex
CREATE INDEX "CanonicalEvent_eventType_eventStatus_publishedAt_idx" ON "CanonicalEvent"("eventType", "eventStatus", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalParticipant_canonicalEventId_countryCode_key" ON "CanonicalParticipant"("canonicalEventId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalEventSource_canonicalEventId_claimId_key" ON "CanonicalEventSource"("canonicalEventId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "MergeCandidate_claimId_canonicalEventId_key" ON "MergeCandidate"("claimId", "canonicalEventId");
