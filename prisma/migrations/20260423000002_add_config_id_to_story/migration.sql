-- Add configId to Story and update unique constraint
ALTER TABLE "Story" ADD COLUMN "configId" TEXT NOT NULL DEFAULT 'en-default';
DROP INDEX "Story_evaluationId_language_key";
CREATE UNIQUE INDEX "Story_evaluationId_language_configId_key" ON "Story"("evaluationId", "language", "configId");
