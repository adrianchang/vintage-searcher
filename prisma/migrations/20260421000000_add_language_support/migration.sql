-- Add language preference to User
ALTER TABLE "User" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';

-- Add language to Story and replace single-column index with composite unique index
ALTER TABLE "Story" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
DROP INDEX "Story_evaluationId_key";
CREATE UNIQUE INDEX "Story_evaluationId_language_key" ON "Story"("evaluationId", "language");
