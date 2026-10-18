-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "ProcessingRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProcessingRun" ("articleId", "createdAt", "durationMs", "error", "finishedAt", "id", "model", "promptVersion", "rawOutput", "status", "warnings") SELECT "articleId", "createdAt", "durationMs", "error", "finishedAt", "id", "model", "promptVersion", "rawOutput", "status", "warnings" FROM "ProcessingRun";
DROP TABLE "ProcessingRun";
ALTER TABLE "new_ProcessingRun" RENAME TO "ProcessingRun";
CREATE INDEX "ProcessingRun_articleId_createdAt_idx" ON "ProcessingRun"("articleId", "createdAt");
CREATE UNIQUE INDEX "ProcessingRun_articleId_model_promptVersion_attempt_key" ON "ProcessingRun"("articleId", "model", "promptVersion", "attempt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
