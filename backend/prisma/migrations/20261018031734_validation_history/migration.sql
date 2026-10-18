-- CreateTable
CREATE TABLE "ClaimValidationDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "validatorVersion" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "nextStatus" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimValidationDecision_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExtractedClaim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimValidationDecision_claimId_validatorVersion_key" ON "ClaimValidationDecision"("claimId", "validatorVersion");
